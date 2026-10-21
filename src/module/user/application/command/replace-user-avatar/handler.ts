/**
 * @file handler.ts
 * @description Replaces an user avatar and resumes obsolete-object cleanup across retries.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_STORAGE_PORT, type IStoragePort, type StorageObject } from 'src/core/storage';
import {
    TOKEN_USER_WRITER_PORT,
    type IUserWriterPort,
} from 'src/module/user/application/command/port/user-writer.port';
import { ReplaceUserAvatarCommand } from 'src/module/user/application/command/replace-user-avatar/command';
import { buildUserPendingAvatarKey, buildUserPermanentAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { UserAuditAction } from 'src/module/user/shared/user-audit';
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
 * Reconciles avatar delivery retries without replacing immutable destinations or newer selections.
 */
@CommandHandler(ReplaceUserAvatarCommand)
export class ReplaceUserAvatarCommandHandler implements ICommandHandler<ReplaceUserAvatarCommand, void> {
    /**
     * Initializes the owner persistence and storage dependencies.
     *
     * @param userWriterPort Loads and saves non-deleted accounts on the primary
     * @param storagePort Copies and deletes objects outside the database transaction
     * @param transactionPort Commits the key transition and its audit together
     * @param auditPort Records one committed attachment transition
     */
    constructor(
        @Inject(TOKEN_USER_WRITER_PORT) private readonly userWriterPort: IUserWriterPort,
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
    async execute(command: ReplaceUserAvatarCommand) {
        const { id, deliveryId, previousAvatarId } = command,
            sourceKey = buildUserPendingAvatarKey(id, deliveryId),
            destinationKey = buildUserPermanentAvatarKey(id, deliveryId),
            user = await this.userWriterPort.load(id);

        if (!user) {
            // Writer loads exclude soft-deleted accounts; their avatars must be retained.
            return;
        }

        let deliveryState: AvatarDeliveryState, obsoleteKeys: readonly string[];

        try {
            deliveryState = user.getAvatarDeliveryState(deliveryId);
            obsoleteKeys = user.getObsoleteAvatarKeys(previousAvatarId);
        } catch (error) {
            if (isExceptionWithAudit(error)) {
                await this.auditPort.record({ ...error.audit, targetId: user.id }, { markExceptionAsAudited: error });
            }

            throw error;
        }

        switch (deliveryState) {
            case AvatarDeliveryState.MISSING:
                throw new TerminalJobException('The user has no attached avatar.');

            case AvatarDeliveryState.SUPERSEDED:
                await Promise.all(
                    [sourceKey, destinationKey, ...obsoleteKeys].map((key) => this.storagePort.deleteObject(key)),
                );

                return;

            case AvatarDeliveryState.FINALIZED:
                // Never recopy a source recreated through a still-valid PUT URL after cleanup.
                if ((await this.findObject(destinationKey)) === null) {
                    throw new TerminalJobException('The attached permanent user avatar object is missing.');
                }

                await Promise.all([...obsoleteKeys, sourceKey].map((key) => this.storagePort.deleteObject(key)));

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
                    action: UserAuditAction.USER_AVATAR_FINALIZED,
                    targetId: user.id,
                    detail: { deliveryId },
                });
            });
        }

        // The replacement is committed. An earlier attempt may have left both forms of its predecessor.
        await Promise.all([...obsoleteKeys, sourceKey].map((key) => this.storagePort.deleteObject(key)));
    }

    /**
     * Rejects unhandled delivery states when the domain vocabulary changes.
     *
     * @param state Exhausted delivery state
     * @throws {SystemException} When an unsupported delivery state reaches the handler
     */
    private assertNeverDeliveryState(state: never): never {
        throw new SystemException(`Unhandled avatar delivery state: ${String(state)}.`, {
            context: { class: ReplaceUserAvatarCommandHandler.name, method: this.execute.name },
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
