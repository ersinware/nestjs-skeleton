/**
 * @file handler.ts
 * @description Replaces an admin avatar and resumes obsolete-object cleanup across retries.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_STORAGE_PORT, type IStoragePort, type StorageObject } from 'src/core/storage';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import { ReplaceAdminAvatarCommand } from 'src/module/admin/application/command/replace-admin-avatar/command';
import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
import { AdminAuditAction } from 'src/module/admin/shared/admin-audit';
import { AVATAR_PERMANENT_CACHE_POLICY } from 'src/shared/domain/avatar';
import {
    ExceptionKind,
    ResourceNotFoundException,
    TerminalJobException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Reconciles avatar delivery retries without replacing immutable destinations or newer selections.
 */
@CommandHandler(ReplaceAdminAvatarCommand)
export class ReplaceAdminAvatarCommandHandler implements ICommandHandler<ReplaceAdminAvatarCommand, void> {
    /**
     * Initializes the owner persistence and storage dependencies.
     *
     * @param adminWriterPort Loads and saves non-deleted accounts on the primary
     * @param storagePort Copies and deletes objects outside the database transaction
     * @param transactionPort Commits the key transition and its audit together
     * @param auditPort Records one committed attachment transition
     */
    constructor(
        @Inject(TOKEN_ADMIN_WRITER_PORT) private readonly adminWriterPort: IAdminWriterPort,
        @Inject(TOKEN_STORAGE_PORT) private readonly storagePort: IStoragePort,
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Copies the selected avatar, commits its permanent key with audit, and deletes obsolete avatar objects.
     *
     * @param command Account and immutable new/previous avatar identities retained for cleanup
     * @throws {ResourceConflictException} When concurrent state prevents attachment or the copy cannot be reconciled
     * @throws {TerminalJobException} When no avatar is attached or the attached permanent object is missing
     * @throws {ResourceNotFoundException} When the expected source is missing or the failed copy cannot be reconciled
     * @throws {InvalidInputException} When delivery keys violate aggregate identity invariants
     * @throws {DependencyUnavailableException} When storage or required database persistence is unavailable
     * @throws {SystemException} When storage metadata or authorization fails, the loaded aggregate is deleted, or delivery acceptance fails
     */
    async execute(command: ReplaceAdminAvatarCommand) {
        const { id, deliveryId, previousAvatarId } = command,
            sourceKey = buildAdminPendingAvatarKey(id, deliveryId),
            destinationKey = buildAdminPermanentAvatarKey(id, deliveryId),
            previousPendingKey = buildAdminPendingAvatarKey(id, previousAvatarId),
            previousPermanentKey = buildAdminPermanentAvatarKey(id, previousAvatarId),
            admin = await this.adminWriterPort.load(id);

        if (!admin) {
            // Writer loads exclude soft-deleted accounts; their avatars must be retained.
            return;
        }

        if (admin.avatarKey === null) {
            throw new TerminalJobException('The admin has no attached avatar.');
        }

        // A later profile update can supersede this delivery before it runs or retries.
        if (admin.avatarKey !== sourceKey && admin.avatarKey !== destinationKey) {
            const promises = [this.storagePort.deleteObject(sourceKey), this.storagePort.deleteObject(destinationKey)];

            // A still-valid upload proof can reselect the previous avatar if its pending object still exists
            // or is recreated through a still-valid PUT URL. While pending is selected, preserve its in-flight copy too.
            if (admin.avatarKey !== previousPendingKey) {
                promises.push(this.storagePort.deleteObject(previousPendingKey));

                // A selected permanent avatar no longer needs its pending source, but must keep its destination.
                if (admin.avatarKey !== previousPermanentKey) {
                    promises.push(this.storagePort.deleteObject(previousPermanentKey));
                }
            }

            await Promise.all(promises);

            return;
        }

        const destinationObject = await this.findObject(destinationKey);

        if (admin.avatarKey === destinationKey) {
            // Never recopy a source recreated through a still-valid PUT URL after the first cleanup.
            if (destinationObject === null) {
                throw new TerminalJobException('The attached permanent admin avatar object is missing.');
            }

            // Resume cleanup after an earlier attempt committed the permanent key.
            await Promise.all([
                this.storagePort.deleteObject(previousPendingKey),
                this.storagePort.deleteObject(previousPermanentKey),
                this.storagePort.deleteObject(sourceKey),
            ]);

            return;
        }

        // Reuse a copy left by an earlier attempt before reading or copying its source again.
        if (destinationObject === null) {
            const sourceObject = await this.findObject(sourceKey);

            // An expired attempt may have created the destination and deleted the source between these reads.
            // Retry with fresh account and object state before deciding that the source is permanently lost.
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

                // An expired attempt can overlap its retry and finish the copy before this failure.
                if (!(await this.findObject(destinationKey))) {
                    throw error;
                }
            }
        }

        let changed: boolean;

        try {
            changed = admin.finalizeAvatar(sourceKey, destinationKey, deliveryId);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: admin.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        if (changed) {
            await this.transactionPort.run(async () => {
                await this.adminWriterPort.save(admin);
                await this.auditPort.record({
                    action: AdminAuditAction.ADMIN_AVATAR_FINALIZED,
                    targetId: admin.id,
                    detail: { deliveryId },
                });
            });
        }

        // The replacement is committed. An earlier attempt may have left both forms of its predecessor.
        await Promise.all([
            this.storagePort.deleteObject(previousPendingKey),
            this.storagePort.deleteObject(previousPermanentKey),
            this.storagePort.deleteObject(sourceKey),
        ]);
    }

    /**
     * Converts only missing-object failures to null so reconciliation can distinguish absence from outages.
     *
     * @param key Object key selected by the owner
     * @returns Stored metadata, or null when the object is missing
     * @throws {DependencyUnavailableException} When storage is unavailable
     * @throws {SystemException} When storage metadata is incomplete or authorization fails
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
