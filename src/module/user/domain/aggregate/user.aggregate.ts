/**
 * @file user.aggregate.ts
 * @description Defines the state and invariants of a user account.
 */

import { randomUUID } from 'node:crypto';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';
import { buildUserPendingAvatarKey, buildUserPermanentAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { UserFailureAuditAction } from 'src/module/user/shared/user-audit';
import { PrincipalAggregateRoot, type PermissionChange } from 'src/shared/domain/aggregate-root';
import { DomainFailureAuditAction } from 'src/shared/domain/audit';
import { PrincipalType, SessionRevocationReason, type Permission, type Principal } from 'src/shared/domain/principal';
import {
    AccessDeniedException,
    AccessDeniedMessage,
    InvalidInputException,
    InvalidInputMessage,
    ResourceConflictException,
    ResourceConflictMessage,
    SystemException,
} from 'src/shared/exception';

/**
 * The module-owned state of a User aggregate.
 */
type UserProps = {
    /**
     * Email address used to sign in and receive account messages.
     */
    email: string;

    /**
     * Display name used in the profile and account messages.
     */
    name: string;

    /**
     * Argon2 password hash used to verify credentials.
     */
    password: string;

    /**
     * Current attached avatar object key.
     */
    avatarKey: string;

    /**
     * Pending activation identity shared with the delivery job.
     */
    activationId: string | null;

    /**
     * Fixed activation deadline at whole-second precision.
     */
    activationExpiresAt: Date | null;

    /**
     * Account revocation version captured when activation proof is issued.
     */
    activationRevocationVersion: number | null;

    /**
     * Request identity shared with the confirmation delivery job.
     */
    pendingEmailRequestId: string | null;

    /**
     * New address awaiting confirmation; never used for sign-in before consumption.
     */
    pendingEmail: string | null;

    /**
     * Fixed confirmation deadline at whole-second precision.
     */
    pendingEmailExpiresAt: Date | null;

    /**
     * Account revocation version captured when the request was created.
     */
    pendingEmailRevocationVersion: number | null;

    /**
     * Whether the account is barred from authentication.
     */
    isBanned: boolean;

    /**
     * Time the account was created.
     */
    createdAt: Date;

    /**
     * Time of the latest account state change.
     */
    updatedAt: Date;
};

/**
 * The full persistable state of a User: the module-owned props plus the identity, persistence
 * version, deletion timestamp, permissions and session counters owned by the aggregate-root bases. Consumed by
 * reconstitution, produced by {@link User.toSnapshot}.
 */
type UserSnapshot = {
    /**
     * Stable account identifier generated as a UUID v7.
     */
    readonly id: string;

    /**
     * Loaded persistence version used to detect concurrent writes.
     */
    readonly version: number;

    /**
     * Soft-deletion time, or null while the account has not been deleted.
     */
    readonly deletedAt: Date | null;

    /**
     * Permission assignments belonging to this account.
     */
    readonly permissions: readonly Permission[];

    /**
     * Access-token version floor and version assigned to newly issued sessions.
     */
    readonly sessionVersion: number;

    /**
     * Version of the last full revocation, used to reject earlier refresh credentials.
     */
    readonly revocationVersion: number;
} & Readonly<UserProps>;

/**
 * Verified upload facts used to accept a profile avatar change.
 */
type UserAvatarChange = {
    /**
     * Pending object key belonging to this account and upload identity.
     */
    readonly fileKey: string;

    /**
     * Avatar identity shared with the update delivery.
     */
    readonly jti: string;

    /**
     * Account revocation version captured when the upload was initiated.
     */
    readonly revocationVersion: number;
};

/**
 * Refusal reasons preserved in user account audit evidence.
 */
enum UserAuditReason {
    /**
     * The account is banned from the requested workflow.
     */
    ACCOUNT_BANNED = 'ACCOUNT_BANNED',
}

/**
 * Pending user activation proof remains valid for three days.
 */
const ACTIVATION_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Pending email confirmations remain valid for thirty minutes from request creation.
 */
const EMAIL_CHANGE_LIFETIME_MS = 30 * 60 * 1000;

/**
 * The User aggregate root. Owns every user invariant: profile updates, ban/unban transitions,
 * session revocation through the monotonic session-version counter, permission changes, and
 * soft-delete immutability. Administrative mutations take the acting principal only for the base
 * class's universal rule (an admin administers); no rank applies across kinds, since the two never
 * share a permission, so the guard's permission alone decides.
 */
export class User extends PrincipalAggregateRoot {
    /**
     * Principal kind used to validate permission ownership.
     */
    protected readonly principalType = PrincipalType.USER;

    /**
     * User-specific state owned by this aggregate.
     */
    private props: UserProps;

    /**
     * Splits the snapshot along the ownership boundary: id, version, deletedAt, permissions and the
     * session counters go to the aggregate-root bases that own them, the rest becomes the module-owned
     * state.
     *
     * @param snapshot The full aggregate state
     */
    private constructor({
        id,
        version,
        deletedAt,
        permissions,
        sessionVersion,
        revocationVersion,
        ...props
    }: UserSnapshot) {
        super(id, version, deletedAt, permissions, sessionVersion, revocationVersion);
        this.props = props;
    }

    /**
     * Creates a pending User with activation and avatar deliveries and no permissions.
     *
     * @param props The new identifier plus the initial properties, excluding lifecycle-managed fields
     * @returns The newly created aggregate
     * @throws {InvalidInputException} When the avatar key is not the registration's pending key
     */
    static create(props: Readonly<Pick<UserSnapshot, 'id' | 'email' | 'name' | 'password' | 'avatarKey'>>): User {
        if (props.avatarKey !== buildUserPendingAvatarKey(props.id, props.id)) {
            throw new InvalidInputException();
        }

        const now = new Date(),
            user = new User({
                ...props,
                activationId: null,
                activationExpiresAt: null,
                activationRevocationVersion: null,
                pendingEmailRequestId: null,
                pendingEmail: null,
                pendingEmailExpiresAt: null,
                pendingEmailRevocationVersion: null,
                isBanned: false,
                version: 0,
                deletedAt: null,
                permissions: [],
                sessionVersion: 0,
                revocationVersion: 0,
                createdAt: now,
                updatedAt: now,
            });

        user.issueActivation();
        user.addActivationJob();
        // Registration uses the account identity as its first avatar version, including before finalization.
        user.addAvatarFinalizeJob(user.id);

        return user;
    }

    /**
     * Reconstitutes an existing User from its persisted state.
     *
     * @param snapshot The persisted aggregate state
     * @returns The reconstituted aggregate
     */
    static reconstitute(snapshot: UserSnapshot): User {
        return new User(snapshot);
    }

    /**
     * Returns the full aggregate state for persistence.
     *
     * @returns Persistable aggregate state
     */
    toSnapshot(): UserSnapshot {
        return {
            id: this.id,
            version: this.version,
            deletedAt: this.deletedAt,
            permissions: [...this.permissions],
            sessionVersion: this.sessionVersion,
            revocationVersion: this.revocationVersion,
            ...this.props,
        };
    }

    /**
     * Requests another activation email with a fresh proof, invalidating the previous link.
     * Audits banned-account refusals through the caller; active accounts return false.
     * The public caller preserves the same response as for an unknown address.
     *
     * @returns Whether an eligible pending account queued a delivery
     * @throws {AccessDeniedException} When a banned account requests another activation email
     * @throws {SystemException} When the account is deleted or pending metadata is incomplete
     */
    resendActivation(): boolean {
        this.assertNotDeleted(this.resendActivation.name);

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: UserFailureAuditAction.USER_ACTIVATION_RESEND_FAILED,
                    reason: UserAuditReason.ACCOUNT_BANNED,
                },
            });
        }

        if (this.props.activationId === null) {
            return false;
        }

        if (this.props.activationExpiresAt === null || this.props.activationRevocationVersion === null) {
            throw new SystemException('Pending user activation metadata is incomplete.', {
                context: { class: User.name, method: this.resendActivation.name, id: this.id },
            });
        }

        this.issueActivation();
        this.props.updatedAt = new Date();
        this.addActivationJob();

        return true;
    }

    /**
     * Consumes activation proof after checking the account and existing password.
     *
     * @param payload Signature-verified activation claims
     * @param currentPasswordMatches Whether the supplied password matches the loaded hash
     * @throws {SystemException} When the account is deleted or differs from the verified subject
     * @throws {AccessDeniedException} When the account is banned
     * @throws {ResourceConflictException} When the account has already been activated
     * @throws {InvalidInputException} When the proof or current password is invalid
     */
    activate(
        payload: {
            readonly sub: string;
            readonly jti: string;
            readonly activationRevocationVersion: number;
            readonly exp: number;
        },
        currentPasswordMatches: boolean,
    ) {
        this.assertNotDeleted(this.activate.name);

        if (payload.sub !== this.id) {
            throw new SystemException('Verified token subject does not match the target account.', {
                context: { class: User.name, method: this.activate.name, id: this.id, sub: payload.sub },
            });
        }

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: UserFailureAuditAction.USER_ACTIVATION_FAILED,
                    reason: UserAuditReason.ACCOUNT_BANNED,
                },
            });
        }

        this.assertCurrentPassword(
            currentPasswordMatches,
            UserFailureAuditAction.USER_ACTIVATION_FAILED,
            InvalidInputMessage.DEFAULT,
        );

        if (this.props.activationId === null) {
            throw new ResourceConflictException(ResourceConflictMessage.DEFAULT);
        }

        if (
            payload.jti !== this.props.activationId ||
            payload.activationRevocationVersion !== this.revocationVersion ||
            payload.activationRevocationVersion !== this.props.activationRevocationVersion ||
            this.props.activationExpiresAt === null ||
            payload.exp * 1000 !== this.props.activationExpiresAt.getTime() ||
            this.props.activationExpiresAt.getTime() <= Date.now()
        ) {
            throw new InvalidInputException(InvalidInputMessage.DEFAULT);
        }

        this.props.activationId = null;
        this.props.activationExpiresAt = null;
        this.props.activationRevocationVersion = null;
        this.props.updatedAt = new Date();
    }

    /**
     * Checks profile avatar eligibility and narrows activation and ban state without changing state.
     *
     * @throws {SystemException} When the account is deleted or pending activation
     * @throws {AccessDeniedException} When the account is banned
     */
    assertAvatarChangeEligible(): asserts this is this & {
        readonly isBanned: false;
        readonly activationId: null;
    } {
        this.assertNotDeleted(this.assertAvatarChangeEligible.name);
        this.assertActivated(this.assertAvatarChangeEligible.name);

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: UserFailureAuditAction.USER_AVATAR_CHANGE_FAILED,
                    reason: UserAuditReason.ACCOUNT_BANNED,
                },
            });
        }
    }

    /**
     * Rejects reuse of the currently selected pending or permanent avatar identity.
     *
     * @param avatarId Identity of the proposed replacement avatar
     * @throws {ResourceConflictException} When this avatar identity is already attached
     */
    assertAvatarReplacementAllowed(avatarId: string) {
        if (
            this.props.avatarKey === buildUserPendingAvatarKey(this.id, avatarId) ||
            this.props.avatarKey === buildUserPermanentAvatarKey(this.id, avatarId)
        ) {
            throw new ResourceConflictException();
        }
    }

    /**
     * Updates supplied profile fields and queues accepted avatar replacements.
     *
     * @param name The new display name, omitted to preserve the current value
     * @param payload Verified avatar upload facts, omitted to preserve the current selection
     * @returns Whether the name or avatar key changed
     * @throws {SystemException} When the account is deleted, pending activation, or the pending key has an unexpected format
     * @throws {AccessDeniedException} When the account is banned
     * @throws {InvalidInputException} When the avatar proof's revocation version differs from the account's
     * @throws {ResourceConflictException} When the proposed avatar identity is already attached
     */
    update(name?: string, payload?: UserAvatarChange): boolean {
        this.assertNotDeleted(this.update.name);
        this.assertActivated(this.update.name);

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: UserFailureAuditAction.USER_UPDATE_FAILED,
                    reason: UserAuditReason.ACCOUNT_BANNED,
                },
            });
        }

        let changed = false;

        if (payload !== undefined) {
            if (payload.revocationVersion !== this.revocationVersion) {
                throw new InvalidInputException();
            }

            if (payload.fileKey !== buildUserPendingAvatarKey(this.id, payload.jti)) {
                throw new SystemException('The pending avatar key is not in the expected format.', {
                    context: { class: User.name, method: this.update.name, id: this.id },
                });
            }

            this.assertAvatarReplacementAllowed(payload.jti);

            this.addAvatarReplaceJob(payload.jti, this.avatarKey.slice(this.avatarKey.lastIndexOf('/') + 1));
            this.props.avatarKey = payload.fileKey;

            changed = true;
        }

        if (name !== undefined && this.props.name !== name) {
            this.props.name = name;

            changed = true;
        }

        if (changed) {
            this.props.updatedAt = new Date();
            this.addCacheInvalidationJob();
        }

        return changed;
    }

    /**
     * Attaches the copied object and queues eviction only on a real key transition.
     *
     * @param expectedPendingKey Source key expected by the owner delivery
     * @param finalKey Verified copy destination
     * @param avatarId Stable avatar identity belonging to the owner delivery
     * @returns Whether the avatar key changed
     * @throws {SystemException} When the account has been deleted
     * @throws {InvalidInputException} When either key does not match the account and avatar identity
     * @throws {ResourceConflictException} When another avatar key is already attached
     */
    finalizeAvatar(expectedPendingKey: string, finalKey: string, avatarId: string): boolean {
        this.assertNotDeleted(this.finalizeAvatar.name);

        if (
            expectedPendingKey !== buildUserPendingAvatarKey(this.id, avatarId) ||
            finalKey !== buildUserPermanentAvatarKey(this.id, avatarId)
        ) {
            throw new InvalidInputException();
        }

        if (this.props.avatarKey === finalKey) {
            return false;
        }

        if (this.props.avatarKey !== expectedPendingKey) {
            throw new ResourceConflictException();
        }

        this.props.avatarKey = finalKey;
        this.props.updatedAt = new Date();
        this.addCacheInvalidationJob();

        return true;
    }

    /**
     * Changes the password after accepting the verification results and revokes existing sessions.
     *
     * @param password Replacement password hash
     * @param currentPasswordMatches Whether the submitted current password matches the loaded hash
     * @param newPasswordMatchesCurrent Whether the proposed new password matches that same hash
     * @throws {SystemException} When the account has been soft-deleted or is pending activation
     * @throws {AccessDeniedException} When the account is banned
     * @throws {InvalidInputException} When the current password is wrong or the new password is unchanged
     */
    changePassword(password: string, currentPasswordMatches: boolean, newPasswordMatchesCurrent: boolean) {
        this.assertNotDeleted(this.changePassword.name);
        this.assertActivated(this.changePassword.name);

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: DomainFailureAuditAction.PASSWORD_CHANGE_FAILED,
                    reason: UserAuditReason.ACCOUNT_BANNED,
                },
            });
        }

        this.assertPasswordChange(
            currentPasswordMatches,
            newPasswordMatchesCurrent,
            DomainFailureAuditAction.PASSWORD_CHANGE_FAILED,
        );

        this.props.password = password;
        this.revokeAllSessions();
        this.props.updatedAt = new Date();

        this.addSessionReconciliationJob();
    }

    /**
     * Replaces the pending email request and queues delivery without revoking sessions.
     *
     * @param newEmail Validated and normalized target email address
     * @param currentPasswordMatches Whether the submitted current password matches the loaded hash
     * @param emailInUse Whether an account already holds the requested address
     * @throws {SystemException} When the account is deleted or pending activation
     * @throws {AccessDeniedException} When the account is banned
     * @throws {InvalidInputException} When the current password is wrong or the address is unchanged
     * @throws {ResourceConflictException} When the target address is already in use
     */
    requestEmailChange(newEmail: string, currentPasswordMatches: boolean, emailInUse: boolean) {
        this.assertNotDeleted(this.requestEmailChange.name);
        this.assertActivated(this.requestEmailChange.name);

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: DomainFailureAuditAction.EMAIL_CHANGE_REQUEST_FAILED,
                    reason: UserAuditReason.ACCOUNT_BANNED,
                },
            });
        }

        this.assertCurrentPassword(currentPasswordMatches, DomainFailureAuditAction.EMAIL_CHANGE_REQUEST_FAILED);

        if (newEmail === this.props.email) {
            throw new InvalidInputException(InvalidInputMessage.EMAIL_UNCHANGED);
        }

        if (emailInUse) {
            throw new ResourceConflictException(ResourceConflictMessage.EMAIL_IN_USE);
        }

        const now = new Date();

        this.props.pendingEmailRequestId = randomUUID();
        this.props.pendingEmail = newEmail;
        this.props.pendingEmailExpiresAt = new Date(Math.floor(now.getTime() / 1000) * 1000 + EMAIL_CHANGE_LIFETIME_MS);
        this.props.pendingEmailRevocationVersion = this.revocationVersion;
        this.props.updatedAt = now;

        this.addJob([
            {
                deliveryId: this.props.pendingEmailRequestId,
                aggregateId: this.id,
                queueName: UserJobQueue.EMAIL_CONFIRMATION,
            },
        ]);
    }

    /**
     * Consumes a matching verified proof, changes the address, and revokes existing sessions.
     *
     * @param payload Identity and expiry claims after signature, type, and principal verification
     * @param notificationId Identity shared with the immutable old-address notification record
     * @throws {SystemException} When the account is deleted, pending activation, or differs from the token subject
     * @throws {AccessDeniedException} When the account is banned
     * @throws {InvalidInputException} When the request is revoked, mismatched, consumed, or expired
     */
    confirmEmailChange(
        payload: {
            readonly sub: string;
            readonly jti: string;
            readonly emailRevocationVersion: number;
            readonly exp: number;
        },
        notificationId: string,
    ) {
        this.assertNotDeleted(this.confirmEmailChange.name);
        this.assertActivated(this.confirmEmailChange.name);

        if (payload.sub !== this.id) {
            throw new SystemException('Verified token subject does not match the target account.', {
                context: { class: User.name, method: this.confirmEmailChange.name, id: this.id, sub: payload.sub },
            });
        }

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: DomainFailureAuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED,
                    reason: UserAuditReason.ACCOUNT_BANNED,
                },
            });
        }

        if (payload.emailRevocationVersion !== this.revocationVersion) {
            throw new InvalidInputException(InvalidInputMessage.DEFAULT);
        }

        if (
            payload.jti !== this.props.pendingEmailRequestId ||
            payload.emailRevocationVersion !== this.props.pendingEmailRevocationVersion ||
            this.props.pendingEmail === null ||
            this.props.pendingEmailExpiresAt === null ||
            payload.exp * 1000 !== this.props.pendingEmailExpiresAt.getTime() ||
            this.props.pendingEmailExpiresAt.getTime() <= Date.now()
        ) {
            throw new InvalidInputException(InvalidInputMessage.DEFAULT);
        }

        this.props.email = this.props.pendingEmail;
        this.props.pendingEmailRequestId = null;
        this.props.pendingEmail = null;
        this.props.pendingEmailExpiresAt = null;
        this.props.pendingEmailRevocationVersion = null;
        this.revokeAllSessions();
        this.props.updatedAt = new Date();

        this.addSessionReconciliationJob();
        this.addCacheInvalidationJob();
        this.addJob([
            {
                deliveryId: notificationId,
                aggregateId: this.id,
                queueName: UserJobQueue.EMAIL_CHANGE_NOTIFICATION,
            },
        ]);
    }

    /**
     * Revokes every active session and raises reason-specific follow-up jobs without banning the user.
     *
     * @param reason Why every session is being revoked
     * @throws {SystemException} When the account is deleted or the revocation reason is unhandled
     */
    revokeSessions(reason: SessionRevocationReason) {
        this.assertNotDeleted(this.revokeSessions.name);

        this.revokeAllSessions();
        this.props.updatedAt = new Date();

        this.addSessionReconciliationJob();

        switch (reason) {
            case SessionRevocationReason.REFRESH_REUSE:
                this.addJob([
                    {
                        deliveryId: randomUUID(),
                        aggregateId: this.id,
                        queueName: UserJobQueue.REFRESH_REUSE_NOTICE,
                    },
                ]);

                break;
            case SessionRevocationReason.LOGOUT_ALL:
                break;
            default:
                assertSessionRevocationReasonExhausted(reason, this.revokeSessions.name);
        }
    }

    /**
     * Replaces the user's permission set and queues cache and session reconciliation when it changes.
     *
     * @param permissions The complete set the user should hold afterwards
     * @param actor The verified principal making the change
     * @returns What was granted and revoked, or null when nothing changed — the caller persists and
     * audits only on a real transition
     * @throws {SystemException} When the account has been soft-deleted or the actor is not an admin
     * @throws {InvalidInputException} When the set holds a permission a user may not hold
     */
    changePermissions(permissions: readonly Permission[], actor: Principal): PermissionChange | null {
        this.assertNotDeleted(this.changePermissions.name);
        this.assertAdministrableBy(actor);

        const changed = this.applyPermissions(permissions);

        if (changed) {
            this.props.updatedAt = new Date();
            this.addCacheInvalidationJob();
            this.addSessionReconciliationJob();
        }

        return changed;
    }

    /**
     * Bans the user and queues cache and session reconciliation. A no-op when already banned.
     *
     * @param actor The verified principal imposing the ban
     * @returns Whether the account actually transitioned — the caller persists, audits, and evicts
     * only on a real ban, so a repeated request triggers none of them.
     * @throws {SystemException} When the account has been soft-deleted or the actor is not an admin
     */
    ban(actor: Principal): boolean {
        this.assertNotDeleted(this.ban.name);
        this.assertAdministrableBy(actor);

        if (this.props.isBanned) {
            return false;
        }

        this.props.isBanned = true;
        this.revokeAllSessions();
        this.props.updatedAt = new Date();

        this.addCacheInvalidationJob();
        this.addSessionReconciliationJob();

        return true;
    }

    /**
     * Unbans the user and queues cache invalidation without lowering the session version.
     *
     * @param actor The verified principal lifting the ban
     * @returns Whether the account actually transitioned — the caller persists and audits only on a
     * real unban, so lifting a ban that was never in place triggers neither.
     * @throws {SystemException} When the account has been soft-deleted or the actor is not an admin
     */
    unban(actor: Principal): boolean {
        this.assertNotDeleted(this.unban.name);
        this.assertAdministrableBy(actor);

        if (!this.props.isBanned) {
            return false;
        }

        this.props.isBanned = false;
        this.props.updatedAt = new Date();

        this.addCacheInvalidationJob();

        return true;
    }

    /**
     * Soft-deletes the activated account and queues cache and session reconciliation.
     * Repeated deletion leaves state and jobs unchanged.
     *
     * @throws {SystemException} When a pending account reaches authenticated self-service
     */
    markAsDeleted() {
        if (this.deletedAt) {
            return;
        }

        this.assertActivated(this.markAsDeleted.name);

        const now = new Date();

        this.setDeletedAt(now);
        this.revokeAllSessions();
        this.props.updatedAt = now;

        this.addCacheInvalidationJob();
        this.addSessionReconciliationJob();
    }

    /**
     * Rejects self-service mutations before email activation and narrows the consumed request identity.
     *
     * @param method The attempted aggregate method
     * @throws {SystemException} When an inactive user reaches authenticated self-service
     */
    private assertActivated(method: string): asserts this is this & {
        readonly activationId: null;
    } {
        if (this.props.activationId !== null) {
            throw new SystemException('An inactive user reached an authenticated self-service flow.', {
                context: { class: User.name, method, id: this.id },
            });
        }
    }

    /**
     * Replaces activation proof with a new request identity and fixed deadline.
     */
    private issueActivation() {
        this.props.activationId = randomUUID();
        this.props.activationExpiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + ACTIVATION_LIFETIME_MS);
        this.props.activationRevocationVersion = this.revocationVersion;
    }

    /**
     * Queues delivery for the current pending activation request.
     *
     * @throws {SystemException} When no pending activation request exists
     */
    private addActivationJob() {
        if (this.props.activationId === null) {
            throw new SystemException('Cannot deliver activation without a pending request.', {
                context: { class: User.name, method: this.addActivationJob.name, id: this.id },
            });
        }

        this.addJob([
            {
                deliveryId: this.props.activationId,
                aggregateId: this.id,
                queueName: UserJobQueue.ACTIVATION,
            },
        ]);
    }

    /**
     * Queues initial avatar finalization with a stable identity retained across retries.
     *
     * @param avatarId Avatar identity shared with the delivery
     */
    private addAvatarFinalizeJob(avatarId: string) {
        this.addJob([
            {
                deliveryId: avatarId,
                aggregateId: this.id,
                queueName: UserJobQueue.AVATAR_FINALIZE,
            },
        ]);
    }

    /**
     * Queues completion of an accepted profile avatar replacement.
     *
     * @param avatarId Profile upload identity retained across retries
     * @param previousAvatarId Previous avatar identity retained for post-commit cleanup
     */
    private addAvatarReplaceJob(avatarId: string, previousAvatarId: string) {
        this.addJob([
            {
                deliveryId: avatarId,
                aggregateId: this.id,
                queueName: UserJobQueue.AVATAR_REPLACE,
                payload: { previousAvatarId },
            },
        ]);
    }

    /**
     * Raises durable cache invalidation for the current user projection.
     */
    private addCacheInvalidationJob() {
        this.addJob([
            {
                deliveryId: randomUUID(),
                aggregateId: this.id,
                queueName: UserJobQueue.CACHE_INVALIDATE,
            },
        ]);
    }

    /**
     * Raises durable session-version reconciliation for the current user.
     */
    private addSessionReconciliationJob() {
        this.addJob([
            {
                deliveryId: randomUUID(),
                aggregateId: this.id,
                queueName: UserJobQueue.SESSION_RECONCILE,
            },
        ]);
    }

    /**
     * Returns the email address.
     *
     * @returns Current email address
     */
    get email(): string {
        return this.props.email;
    }

    /**
     * Returns the display name.
     *
     * @returns Current display name
     */
    get name(): string {
        return this.props.name;
    }

    /**
     * Returns the password hash.
     *
     * @returns Current password hash
     */
    get password(): string {
        return this.props.password;
    }

    /**
     * Returns the attached avatar without constructing a delivery URL.
     *
     * @returns Current attached object key
     */
    get avatarKey(): string {
        return this.props.avatarKey;
    }

    /**
     * Returns the pending activation identity.
     *
     * @returns The stored value, or null when no activation is pending
     */
    get activationId(): string | null {
        return this.props.activationId;
    }

    /**
     * Returns the fixed activation deadline.
     *
     * @returns The stored value, or null when no activation is pending
     */
    get activationExpiresAt(): Date | null {
        return this.props.activationExpiresAt;
    }

    /**
     * Returns the revocation version captured for activation.
     *
     * @returns The stored value, or null when no activation is pending
     */
    get activationRevocationVersion(): number | null {
        return this.props.activationRevocationVersion;
    }

    /**
     * Request identity shared with the confirmation delivery job.
     *
     * @returns The stored value, or null when no request is pending
     */
    get pendingEmailRequestId(): string | null {
        return this.props.pendingEmailRequestId;
    }

    /**
     * New address awaiting confirmation; never used for sign-in before consumption.
     *
     * @returns The stored value, or null when no request is pending
     */
    get pendingEmail(): string | null {
        return this.props.pendingEmail;
    }

    /**
     * Fixed confirmation deadline at whole-second precision.
     *
     * @returns The stored value, or null when no request is pending
     */
    get pendingEmailExpiresAt(): Date | null {
        return this.props.pendingEmailExpiresAt;
    }

    /**
     * Account revocation version captured when the request was created.
     *
     * @returns The stored value, or null when no request is pending
     */
    get pendingEmailRevocationVersion(): number | null {
        return this.props.pendingEmailRevocationVersion;
    }

    /**
     * Returns whether the account is banned.
     *
     * @returns Current ban state
     */
    get isBanned(): boolean {
        return this.props.isBanned;
    }

    /**
     * Returns the creation timestamp.
     *
     * @returns Creation timestamp
     */
    get createdAt(): Date {
        return this.props.createdAt;
    }

    /**
     * Returns the last-update timestamp.
     *
     * @returns Last-update timestamp
     */
    get updatedAt(): Date {
        return this.props.updatedAt;
    }
}

/**
 * Rejects an unhandled session revocation reason.
 *
 * @param reason Unhandled reason
 * @param method Calling aggregate method
 * @returns Never returns normally
 * @throws {SystemException} Always
 */
function assertSessionRevocationReasonExhausted(reason: never, method: string): never {
    throw new SystemException(`Unhandled session revocation reason: ${String(reason)}.`, {
        context: { class: User.name, method },
    });
}
