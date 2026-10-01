/**
 * @file handler.ts
 * @description Reconciles a user avatar copy, atomic key transition, and post-commit source cleanup.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_STORAGE_PORT, type IStoragePort, type StorageObject } from 'src/core/storage';
import { MoveUserAvatarCommand } from 'src/module/user/application/command/move-user-avatar/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { buildUserPendingAvatarKey, buildUserPermanentAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { ExceptionKind, TerminalJobException, isExceptionOfKind } from 'src/shared/exception';

/**
 * Browser cache lifetime for immutable avatar versions.
 */
const AVATAR_CACHE_MAX_AGE_SECONDS = 31_536_000;

/**
 * Shared cache lifetime for immutable avatar versions.
 */
const AVATAR_SHARED_CACHE_MAX_AGE_SECONDS = 31_536_000;

/**
 * Keeps the pending object available until the permanent key commits with audit and cache eviction.
 */
@CommandHandler(MoveUserAvatarCommand)
export class MoveUserAvatarCommandHandler implements ICommandHandler<MoveUserAvatarCommand, void> {
    /**
     * Initializes the owner persistence and storage dependencies.
     *
     * @param userWriterPort Loads and saves non-deleted accounts on the primary
     * @param storagePort Copies and deletes objects outside the database transaction
     * @param transactionPort Commits the key transition and its durable follow-up work
     * @param auditPort Records one committed attachment transition
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Reconciles repeated delivery; failures propagate to the existing queue retry boundary.
     *
     * @param command Account and immutable avatar delivery identities
     * @throws {ResourceConflictException} When concurrent state prevents attachment or the copy cannot be reconciled
     * @throws {ResourceNotFoundException} When the expected source and destination are both missing
     * @throws {TerminalJobException} When the attached permanent object is missing or another avatar key is attached
     * @throws {DependencyUnavailableException} When storage or required database persistence is unavailable
     * @throws {SystemException} When storage authorization or delivery acceptance fails
     */
    async execute(command: MoveUserAvatarCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            return;
        }

        const { deliveryId } = command,
            sourceKey = buildUserPendingAvatarKey(user.id),
            destinationKey = buildUserPermanentAvatarKey(user.id, deliveryId);

        if (user.avatarKey === destinationKey) {
            // Never recopy a source recreated through a still-valid PUT URL after the first cleanup.
            try {
                await this.storagePort.headObject(destinationKey);
            } catch (error) {
                if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
                    throw new TerminalJobException('The attached permanent user avatar object is missing.', {
                        cause: error,
                    });
                }

                throw error;
            }

            await this.storagePort.deleteObject(sourceKey);

            return;
        }

        if (user.avatarKey !== sourceKey) {
            throw new TerminalJobException(
                'The attached user avatar key does not match this delivery source or destination.',
            );
        }

        // Reuse copies left by earlier attempts and recover copy/cleanup races before attaching the key.
        if (!(await this.findObject(destinationKey))) {
            try {
                const source = await this.storagePort.headObject(sourceKey);

                await this.storagePort.copyObject({
                    sourceKey,
                    destinationKey,
                    sourceEtag: source.etag,
                    contentType: source.contentType!,
                    cache: {
                        visibility: 'public',
                        maxAgeSeconds: AVATAR_CACHE_MAX_AGE_SECONDS,
                        sharedMaxAgeSeconds: AVATAR_SHARED_CACHE_MAX_AGE_SECONDS,
                        immutable: true,
                    },
                });
            } catch (error) {
                if (
                    !isExceptionOfKind(error, ExceptionKind.RESOURCE_CONFLICT) &&
                    !isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)
                ) {
                    throw error;
                }

                // Another worker may have copied and cleaned up while this attempt was in flight.
                if (!(await this.findObject(destinationKey))) {
                    throw error;
                }
            }
        }

        if (user.finalizeAvatar(sourceKey, destinationKey, deliveryId)) {
            await this.transactionPort.run(async () => {
                await this.userWriterPort.save(user);
                await this.auditPort.record({
                    action: AuditAction.USER_AVATAR_FINALIZED,
                    targetId: user.id,
                    detail: { deliveryId: deliveryId },
                });
            });
        }

        await this.storagePort.deleteObject(sourceKey);
    }

    /**
     * Treats missing objects as a reconciliation case without swallowing dependency failures.
     *
     * @param key Object key selected by the owner
     * @returns Stored metadata, or null when the object is missing
     * @throws {DependencyUnavailableException} When storage is unavailable
     * @throws {SystemException} When storage authorization fails
     */
    private async findObject(key: string): Promise<StorageObject | null> {
        try {
            return await this.storagePort.headObject(key);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
                return null;
            }

            throw error;
        }
    }
}
