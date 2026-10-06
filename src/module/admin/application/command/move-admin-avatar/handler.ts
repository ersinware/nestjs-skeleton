/**
 * @file handler.ts
 * @description Reconciles an admin avatar copy, atomic key transition, and post-commit source cleanup.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_STORAGE_PORT, type IStoragePort, type StorageObject } from 'src/core/storage';
import { MoveAdminAvatarCommand } from 'src/module/admin/application/command/move-admin-avatar/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
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
 * Keeps the pending object available until the permanent key commits with audit.
 */
@CommandHandler(MoveAdminAvatarCommand)
export class MoveAdminAvatarCommandHandler implements ICommandHandler<MoveAdminAvatarCommand, void> {
    /**
     * Initializes the owner persistence and storage dependencies.
     *
     * @param adminWriterPort Loads and saves non-deleted accounts on the primary
     * @param storagePort Copies and deletes objects outside the database transaction
     * @param transactionPort Commits the key transition and its durable follow-up work
     * @param auditPort Records one committed attachment transition
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
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
    async execute(command: MoveAdminAvatarCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            return;
        }

        const { deliveryId } = command,
            sourceKey = buildAdminPendingAvatarKey(admin.id, deliveryId),
            destinationKey = buildAdminPermanentAvatarKey(admin.id, deliveryId);

        if (admin.avatarKey === destinationKey) {
            // Never recopy a source recreated through a still-valid PUT URL after the first cleanup.
            try {
                await this.storagePort.headObject(destinationKey);
            } catch (error) {
                if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
                    throw new TerminalJobException('The attached permanent admin avatar object is missing.', {
                        cause: error,
                    });
                }

                throw error;
            }

            await this.storagePort.deleteObject(sourceKey);

            return;
        }

        if (admin.avatarKey !== sourceKey) {
            throw new TerminalJobException(
                'The attached admin avatar key does not match this delivery source or destination.',
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

        if (admin.finalizeAvatar(sourceKey, destinationKey, deliveryId)) {
            await this.transactionPort.run(async () => {
                await this.adminWriterPort.save(admin);
                await this.auditPort.record({
                    action: AuditAction.ADMIN_AVATAR_FINALIZED,
                    targetId: admin.id,
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
