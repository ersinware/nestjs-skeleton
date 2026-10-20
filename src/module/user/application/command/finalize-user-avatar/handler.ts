/**
 * @file handler.ts
 * @description Reconciles a user avatar copy, atomic key transition, and post-commit source cleanup.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_STORAGE_PORT, type IStoragePort, type StorageObject } from 'src/core/storage';
import { FinalizeUserAvatarCommand } from 'src/module/user/application/command/finalize-user-avatar/command';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { buildUserPendingAvatarKey, buildUserPermanentAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { AVATAR_PERMANENT_CACHE_POLICY } from 'src/shared/domain/avatar';
import {
    ExceptionKind,
    ResourceNotFoundException,
    TerminalJobException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Keeps the pending object available until the permanent key commits with audit and cache eviction.
 */
@CommandHandler(FinalizeUserAvatarCommand)
export class FinalizeUserAvatarCommandHandler implements ICommandHandler<FinalizeUserAvatarCommand, void> {
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
     * @throws {TerminalJobException} When the attached permanent object is missing
     * @throws {ResourceNotFoundException} When the expected source is missing; retries re-read account state
     * @throws {InvalidInputException} When delivery keys violate aggregate identity invariants
     * @throws {DependencyUnavailableException} When storage or required database persistence is unavailable
     * @throws {SystemException} When storage metadata or authorization fails, the loaded aggregate is deleted, or delivery acceptance fails
     */
    async execute(command: FinalizeUserAvatarCommand) {
        const user = await this.userWriterPort.load(command.id);

        if (!user) {
            return;
        }

        const { deliveryId } = command,
            sourceKey = buildUserPendingAvatarKey(user.id, deliveryId),
            destinationKey = buildUserPermanentAvatarKey(user.id, deliveryId);

        // An initial delivery may retry after a profile replacement; never reattach the initial avatar.
        if (user.avatarKey !== sourceKey && user.avatarKey !== destinationKey) {
            return;
        }

        const destinationObject = await this.findObject(destinationKey);

        if (user.avatarKey === destinationKey) {
            // Never recopy a source recreated through a still-valid PUT URL after the first cleanup.
            if (destinationObject === null) {
                throw new TerminalJobException('The attached permanent user avatar object is missing.');
            }

            await this.storagePort.deleteObject(sourceKey);

            return;
        }

        // Reuse a copy left by an earlier attempt before reading or copying its source again.
        if (destinationObject === null) {
            const sourceObject = await this.findObject(sourceKey);

            // An expired attempt may have created the destination and deleted the source between these reads.
            // Retry to read the current account and destination instead of treating both objects as permanently lost.
            if (sourceObject === null) {
                throw new ResourceNotFoundException();
            }

            try {
                await this.storagePort.copyObject({
                    sourceKey,
                    destinationKey,
                    sourceEtag: sourceObject.etag,
                    contentType: sourceObject.contentType!,
                    cache: AVATAR_PERMANENT_CACHE_POLICY,
                });
            } catch (error) {
                if (
                    !isExceptionOfKind(error, ExceptionKind.RESOURCE_CONFLICT) &&
                    !isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)
                ) {
                    throw error;
                }

                // A competing attempt may have created the immutable destination before this failure.
                if (!(await this.findObject(destinationKey))) {
                    throw error;
                }
            }
        }

        let changed;

        try {
            changed = user.finalizeAvatar(sourceKey, destinationKey, deliveryId);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: user.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        if (changed) {
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
