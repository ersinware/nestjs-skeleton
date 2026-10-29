/**
 * @file handler.ts
 * @description Finalizes the initial admin avatar with an atomic key transition and post-commit source cleanup.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_STORAGE_PORT, type IStoragePort, type StorageObject } from 'src/core/storage';
import { FinalizeAdminAvatarCommand } from 'src/module/admin/application/command/finalize-admin-avatar/command';
import {
    TOKEN_ADMIN_WRITER_PORT,
    type IAdminWriterPort,
} from 'src/module/admin/application/command/port/admin-writer.port';
import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
import { AdminAuditAction } from 'src/module/admin/shared/admin-audit';
import { AVATAR_PERMANENT_CACHE_POLICY, AvatarDeliveryState } from 'src/shared/domain/avatar';
import {
    ExceptionKind,
    ResourceNotFoundException,
    SystemException,
    TerminalJobException,
    isExceptionOfKind,
    isExceptionWithAudit,
} from 'src/shared/exception';

/**
 * Finalizes the initial avatar while preserving completed copies across retries.
 */
@CommandHandler(FinalizeAdminAvatarCommand)
export class FinalizeAdminAvatarCommandHandler implements ICommandHandler<FinalizeAdminAvatarCommand, void> {
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
     * Copies the selected avatar, commits its permanent key with audit, and cleans up its source.
     *
     * @param command Account and immutable avatar delivery identities
     * @throws {ResourceConflictException} When concurrent state prevents attachment or the copy cannot be reconciled
     * @throws {TerminalJobException} When no avatar is attached or the attached permanent object is missing
     * @throws {ResourceNotFoundException} When the expected source is missing; retries re-read account state
     * @throws {InvalidInputException} When delivery keys violate aggregate identity invariants
     * @throws {DependencyUnavailableException} When storage or required database persistence is unavailable
     * @throws {SystemException} When storage metadata or authorization fails, the loaded aggregate is deleted, or delivery acceptance fails
     */
    async execute(command: FinalizeAdminAvatarCommand) {
        const admin = await this.adminWriterPort.load(command.id);

        if (!admin) {
            return;
        }

        const { deliveryId } = command,
            sourceKey = buildAdminPendingAvatarKey(admin.id, deliveryId),
            destinationKey = buildAdminPermanentAvatarKey(admin.id, deliveryId);

        let deliveryState: AvatarDeliveryState;

        try {
            deliveryState = admin.getAvatarDeliveryState(deliveryId);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: admin.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        switch (deliveryState) {
            case AvatarDeliveryState.MISSING:
                throw new TerminalJobException('The admin has no attached avatar.');

            case AvatarDeliveryState.SUPERSEDED:
                return;

            case AvatarDeliveryState.FINALIZED:
                // Never recopy a source recreated through a still-valid PUT URL after cleanup.
                if ((await this.findObject(destinationKey)) === null) {
                    throw new TerminalJobException('The attached permanent admin avatar object is missing.');
                }

                await this.storagePort.deleteObject(sourceKey);

                return;

            case AvatarDeliveryState.PENDING:
                break;

            default:
                this.assertNeverDeliveryState(deliveryState);
        }

        const destinationObject = await this.findObject(destinationKey);

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
            changed = admin.finalizeAvatar(sourceKey, destinationKey, deliveryId);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: admin.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        if (changed) {
            await this.transactionPort.start(async () => {
                await this.adminWriterPort.save(admin);
                await this.auditPort.record({
                    action: AdminAuditAction.ADMIN_AVATAR_FINALIZED,
                    targetId: admin.id,
                    detail: { deliveryId },
                });
            });
        }

        await this.storagePort.deleteObject(sourceKey);
    }

    /**
     * Rejects unhandled delivery states when the domain vocabulary changes.
     *
     * @param state Exhausted delivery state
     * @throws {SystemException} When an unsupported delivery state reaches the handler
     */
    private assertNeverDeliveryState(state: never): never {
        throw new SystemException(`Unhandled avatar delivery state: ${String(state)}.`, {
            context: { class: FinalizeAdminAvatarCommandHandler.name, method: this.execute.name },
        });
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
