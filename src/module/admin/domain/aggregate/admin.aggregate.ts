/**
 * @file admin.aggregate.ts
 * @description Defines the state and invariants of an admin account.
 */

import { randomUUID } from 'node:crypto';
import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { AdminAuditAction } from 'src/module/admin/shared/admin-audit';
import { PrincipalAggregateRoot, type PermissionChange } from 'src/shared/domain/aggregate-root';
import { DomainFailureAuditAction } from 'src/shared/domain/audit';
import { Permission, PrincipalType, SessionRevocationReason, type Principal } from 'src/shared/domain/principal';
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
 * The module-owned state of an Admin aggregate.
 */
type AdminProps = {
    /**
     * Email address used to sign in and receive account messages.
     */
    email: string;

    /**
     * Display name used in the profile and account messages.
     */
    name: string;

    /**
     * Argon2 password hash, or null until the invited admin activates the account.
     */
    password: string | null;

    /**
     * Uploaded avatar object key, or null before invitation completion.
     */
    avatarKey: string | null;

    /**
     * Identity shared with the invitation delivery job.
     */
    inviteId: string | null;

    /**
     * Fixed JWT expiry, cleared when the invitation is consumed.
     */
    inviteExpiresAt: Date | null;

    /**
     * Account revocation version captured when the invitation is issued.
     */
    inviteRevocationVersion: number | null;

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
 * Persistable state of an Admin aggregate.
 */
type AdminSnapshot = {
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
     * Version of the last full revocation, used to reject earlier refresh credentials and invitations.
     */
    readonly revocationVersion: number;
} & Readonly<AdminProps>;

/**
 * Verified invitation facts used by preparation and activation.
 */
type AdminInvitation = {
    /**
     * Invited account identity.
     */
    readonly sub: string;

    /**
     * Stored invitation identity.
     */
    readonly jti: string;

    /**
     * Revocation version captured at issuance.
     */
    readonly inviteRevocationVersion: number;

    /**
     * Fixed invitation deadline in Unix seconds.
     */
    readonly exp: number;
};

/**
 * Verified upload facts used to accept a profile avatar change.
 */
type AdminAvatarChange = {
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
 * Refusal reasons preserved in admin account audit evidence.
 */
enum AdminAuditReason {
    /**
     * The actor attempted to administer their own account.
     */
    SELF_TARGET = 'SELF_TARGET',

    /**
     * The target account holds root authority.
     */
    ROOT_TARGET = 'ROOT_TARGET',

    /**
     * The actor lacks root authority to administer a permission manager.
     */
    MANAGER_REQUIRES_ROOT = 'MANAGER_REQUIRES_ROOT',

    /**
     * Root authority cannot be granted through an administrative mutation.
     */
    ROOT_PERMISSION_GRANT_FORBIDDEN = 'ROOT_PERMISSION_GRANT_FORBIDDEN',

    /**
     * The actor lacks root authority to appoint a permission manager.
     */
    MANAGER_APPOINTMENT_REQUIRES_ROOT = 'MANAGER_APPOINTMENT_REQUIRES_ROOT',

    /**
     * The account is banned from the requested workflow.
     */
    ACCOUNT_BANNED = 'ACCOUNT_BANNED',
}

/**
 * Pending admin invitations remain valid for three days from issuance.
 */
const INVITATION_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Pending email confirmations remain valid for thirty minutes from request creation.
 */
const EMAIL_CHANGE_LIFETIME_MS = 30 * 60 * 1000;

/**
 * Owns admin lifecycle, authorization hierarchy, permissions, and session revocation.
 */
export class Admin extends PrincipalAggregateRoot {
    /**
     * Principal kind used to validate permission ownership.
     */
    protected readonly principalType = PrincipalType.ADMIN;

    /**
     * Admin-specific state.
     */
    private props: AdminProps;

    /**
     * Initializes the aggregate from persisted state.
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
    }: AdminSnapshot) {
        super(id, version, deletedAt, permissions, sessionVersion, revocationVersion);
        this.props = props;
    }

    /**
     * Creates an admin and queues an invitation when no password is supplied.
     *
     * @param props The new identifier plus the initial properties, excluding lifecycle-managed fields
     * @returns The newly created aggregate
     */
    static create(props: Readonly<Pick<AdminSnapshot, 'id' | 'email' | 'name' | 'password'>>): Admin {
        const now = new Date(),
            admin = new Admin({
                ...props,
                avatarKey: null,
                inviteId: null,
                inviteExpiresAt: null,
                inviteRevocationVersion: null,
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

        if (props.password === null) {
            admin.issueInvitation();
            admin.addInvitationJob();
        }

        return admin;
    }

    /**
     * Reconstitutes an existing Admin from its persisted state.
     *
     * @param snapshot The persisted aggregate state
     * @returns The reconstituted aggregate
     */
    static reconstitute(snapshot: AdminSnapshot): Admin {
        return new Admin(snapshot);
    }

    /**
     * Returns the aggregate state for persistence.
     *
     * @returns Persistable aggregate state
     */
    toSnapshot(): AdminSnapshot {
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
     * Revokes existing invitations and queues a replacement for a pending admin.
     *
     * @param actor The verified principal requesting the invitation
     * @throws {SystemException} When the account is deleted or the actor is not an admin
     * @throws {AccessDeniedException} When the actor cannot administer the target
     * @throws {ResourceConflictException} When the account is already active or banned
     */
    reInvite(actor: Principal) {
        this.assertNotDeleted(this.reInvite.name);
        this.assertAdministrableBy(actor);

        if (this.props.isBanned) {
            throw new ResourceConflictException('A banned account cannot be re-invited.', {
                audit: {
                    action: AdminAuditAction.ADMIN_INVITATION_FAILED,
                    reason: AdminAuditReason.ACCOUNT_BANNED,
                },
            });
        }

        if (this.props.password !== null) {
            throw new ResourceConflictException('The account has already been activated.');
        }

        this.revokeAllSessions();
        this.issueInvitation();
        this.props.updatedAt = new Date();
        this.addInvitationJob();
    }

    /**
     * Validates the live invitation and narrows its required metadata without changing state.
     *
     * @param payload Signature-verified invitation claims
     * @throws {SystemException} When the account is deleted, differs from the verified subject, or is inactive with an attached avatar
     * @throws {AccessDeniedException} When the account is banned
     * @throws {ResourceConflictException} When the account is already active
     * @throws {InvalidInputException} When the invitation is revoked, mismatched, or expired
     */
    assertActivationInvitationValid(payload: AdminInvitation): asserts this is this & {
        readonly isBanned: false;
        readonly inviteId: string;
        readonly inviteExpiresAt: Date;
        readonly inviteRevocationVersion: number;
    } {
        this.assertActivationEligibility(payload, this.assertActivationInvitationValid.name);
    }

    /**
     * Activates a pending admin after checking account and invitation eligibility.
     *
     * @param password The Argon2-hashed initial password
     * @param payload Identity and timing claims from the verified invitation
     * @param avatarKey Verified pending avatar belonging to this invitation
     * @throws {SystemException} When the account is deleted, differs from the token subject, or is inactive with an attached avatar
     * @throws {AccessDeniedException} When the account is banned
     * @throws {ResourceConflictException} When the account is already active
     * @throws {InvalidInputException} When the invitation is revoked, mismatched, expired, or the avatar key belongs to another invitation
     */
    activate(password: string, payload: AdminInvitation, avatarKey: string) {
        this.assertActivationEligibility(payload, this.activate.name);

        if (avatarKey !== buildAdminPendingAvatarKey(this.id, payload.jti)) {
            throw new InvalidInputException();
        }

        this.props.password = password;
        this.props.avatarKey = avatarKey;
        this.props.inviteId = null;
        this.props.inviteExpiresAt = null;
        this.props.inviteRevocationVersion = null;
        this.props.updatedAt = new Date();

        this.addAvatarFinalizeJob(payload.jti);
    }

    /**
     * Checks profile avatar eligibility and narrows the attached password and avatar without changing state.
     *
     * @throws {SystemException} When the account is deleted or lacks an activation password or avatar
     * @throws {AccessDeniedException} When the account is banned
     */
    assertAvatarChangeEligible(): asserts this is this & {
        readonly isBanned: false;
        readonly password: string;
        readonly avatarKey: string;
    } {
        this.assertNotDeleted(this.assertAvatarChangeEligible.name);
        this.assertActivated(this.assertAvatarChangeEligible.name);

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: AdminAuditAction.ADMIN_AVATAR_CHANGE_FAILED,
                    reason: AdminAuditReason.ACCOUNT_BANNED,
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
            this.props.avatarKey === buildAdminPendingAvatarKey(this.id, avatarId) ||
            this.props.avatarKey === buildAdminPermanentAvatarKey(this.id, avatarId)
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
     * @throws {SystemException} When the account is deleted, lacks a password or avatar, or the pending key has an unexpected format
     * @throws {AccessDeniedException} When the account is banned
     * @throws {InvalidInputException} When the avatar proof's revocation version differs from the account's
     * @throws {ResourceConflictException} When the proposed avatar identity is already attached
     */
    update(name?: string, payload?: AdminAvatarChange): boolean {
        this.assertNotDeleted(this.update.name);
        this.assertActivated(this.update.name);

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: AdminAuditAction.ADMIN_UPDATE_FAILED,
                    reason: AdminAuditReason.ACCOUNT_BANNED,
                },
            });
        }

        let changed = false;

        if (payload !== undefined) {
            if (payload.revocationVersion !== this.revocationVersion) {
                throw new InvalidInputException();
            }

            if (payload.fileKey !== buildAdminPendingAvatarKey(this.id, payload.jti)) {
                throw new SystemException('The pending avatar key is not in the expected format.', {
                    context: { class: Admin.name, method: this.update.name, id: this.id },
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
        }

        return changed;
    }

    /**
     * Attaches an immutable copy only for the expected avatar delivery source.
     *
     * @param expectedPendingKey Source key selected for the avatar delivery
     * @param finalKey Verified permanent destination
     * @param avatarId Stable avatar identity retained across delivery attempts
     * @returns Whether the avatar key changed
     * @throws {SystemException} When the account has been deleted
     * @throws {InvalidInputException} When either key differs from the account and avatar identity
     * @throws {ResourceConflictException} When another avatar key is already attached
     */
    finalizeAvatar(expectedPendingKey: string, finalKey: string, avatarId: string): boolean {
        this.assertNotDeleted(this.finalizeAvatar.name);

        if (
            expectedPendingKey !== buildAdminPendingAvatarKey(this.id, avatarId) ||
            finalKey !== buildAdminPermanentAvatarKey(this.id, avatarId)
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

        return true;
    }

    /**
     * Changes the password and revokes existing sessions.
     *
     * @param password Replacement password hash
     * @param currentPasswordMatches Whether the submitted current password matches the loaded hash
     * @param newPasswordMatchesCurrent Whether the proposed new password matches that same hash
     * @throws {SystemException} When the account is deleted or lacks an activation password or avatar
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
                    reason: AdminAuditReason.ACCOUNT_BANNED,
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
     * @throws {SystemException} When the account is deleted or lacks an activation password or avatar
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
                    reason: AdminAuditReason.ACCOUNT_BANNED,
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
                queueName: AdminJobQueue.EMAIL_CONFIRMATION,
            },
        ]);
    }

    /**
     * Consumes a matching verified proof, changes the address, and revokes existing sessions.
     *
     * @param payload Identity and expiry claims after signature, type, and principal verification
     * @param notificationId Identity shared with the immutable old-address notification record
     * @throws {SystemException} When the account is deleted, lacks an activation password or avatar, or differs from the token subject
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
                context: { class: Admin.name, method: this.confirmEmailChange.name, id: this.id, sub: payload.sub },
            });
        }

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: DomainFailureAuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED,
                    reason: AdminAuditReason.ACCOUNT_BANNED,
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
        this.addJob([
            {
                deliveryId: notificationId,
                aggregateId: this.id,
                queueName: AdminJobQueue.EMAIL_CHANGE_NOTIFICATION,
            },
        ]);
    }

    /**
     * Revokes all sessions and raises reason-specific follow-up jobs without banning the admin.
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
                        queueName: AdminJobQueue.REFRESH_REUSE_NOTICE,
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
     * Replaces permissions and retires access tokens carrying the previous set.
     *
     * @param permissions The complete set the admin should hold afterwards
     * @param actor The verified principal making the change
     * @returns Granted and revoked permissions, or null when unchanged
     * @throws {SystemException} When the account has been soft-deleted or the actor is not an admin
     * @throws {AccessDeniedException} When the actor or requested hierarchy change is forbidden
     * @throws {InvalidInputException} When the set holds a permission an admin may not hold
     */
    changePermissions(permissions: readonly Permission[], actor: Principal): PermissionChange | null {
        this.assertNotDeleted(this.changePermissions.name);
        this.assertAdministrableBy(actor);

        // Root is provisioned outside this mutation and cannot be granted.
        if (permissions.includes(Permission.ADMIN_ROOT)) {
            throw new AccessDeniedException(
                'The root permission is held by exactly one account and is never granted.',
                {
                    audit: {
                        action: AdminAuditAction.ADMIN_ADMINISTRATION_DENIED,
                        reason: AdminAuditReason.ROOT_PERMISSION_GRANT_FORBIDDEN,
                    },
                },
            );
        }

        // Only root may appoint a permission manager.
        if (
            permissions.includes(Permission.ADMIN_PERMISSION_MANAGE) &&
            !actor.permissions.includes(Permission.ADMIN_ROOT)
        ) {
            throw new AccessDeniedException('Only root may appoint a permission manager.', {
                audit: {
                    action: AdminAuditAction.ADMIN_ADMINISTRATION_DENIED,
                    reason: AdminAuditReason.MANAGER_APPOINTMENT_REQUIRES_ROOT,
                },
            });
        }

        const changed = this.applyPermissions(permissions);

        if (changed) {
            this.props.updatedAt = new Date();
            this.addSessionReconciliationJob();
        }

        return changed;
    }

    /**
     * Bans the admin and revokes existing sessions.
     *
     * @param actor The verified principal imposing the ban
     * @returns Whether the account transitioned to banned
     * @throws {SystemException} When the account has been soft-deleted or the actor is not an admin
     * @throws {AccessDeniedException} When the actor cannot administer the target
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

        this.addSessionReconciliationJob();

        return true;
    }

    /**
     * Unbans the admin without lowering session floors.
     *
     * @param actor The verified principal lifting the ban
     * @returns Whether the account transitioned to unbanned
     * @throws {SystemException} When the account has been soft-deleted or the actor is not an admin
     * @throws {AccessDeniedException} When the actor cannot administer the target
     */
    unban(actor: Principal): boolean {
        this.assertNotDeleted(this.unban.name);
        this.assertAdministrableBy(actor);

        if (!this.props.isBanned) {
            return false;
        }

        this.props.isBanned = false;
        this.props.updatedAt = new Date();

        return true;
    }

    /**
     * Soft-deletes a pending or activated admin and queues session reconciliation.
     * Repeated deletion still checks the actor but leaves state and jobs unchanged.
     *
     * @param actor The verified principal deleting the account
     * @throws {AccessDeniedException} When the actor cannot administer the target
     * @throws {SystemException} When the actor is not an admin
     */
    markAsDeleted(actor: Principal) {
        this.assertAdministrableBy(actor);

        if (this.deletedAt) {
            return;
        }

        const now = new Date();

        this.setDeletedAt(now);
        this.revokeAllSessions();
        this.props.updatedAt = now;

        this.addSessionReconciliationJob();
    }

    /**
     * Enforces self, root, and permission-manager administration restrictions.
     *
     * @param actor The verified principal performing the administration
     * @throws {SystemException} When a non-admin actor reaches the mutation
     * @throws {AccessDeniedException} When the actor cannot administer the target
     */
    protected override assertAdministrableBy(actor: Principal) {
        super.assertAdministrableBy(actor);

        if (actor.id === this.id) {
            throw new AccessDeniedException('An admin cannot administer their own account.', {
                audit: {
                    action: AdminAuditAction.ADMIN_ADMINISTRATION_DENIED,
                    reason: AdminAuditReason.SELF_TARGET,
                },
            });
        }

        if (this.permissions.includes(Permission.ADMIN_ROOT)) {
            throw new AccessDeniedException('The root account cannot be administered.', {
                audit: {
                    action: AdminAuditAction.ADMIN_ADMINISTRATION_DENIED,
                    reason: AdminAuditReason.ROOT_TARGET,
                },
            });
        }

        if (
            this.permissions.includes(Permission.ADMIN_PERMISSION_MANAGE) &&
            !actor.permissions.includes(Permission.ADMIN_ROOT)
        ) {
            throw new AccessDeniedException('A permission manager is administered by root alone.', {
                audit: {
                    action: AdminAuditAction.ADMIN_ADMINISTRATION_DENIED,
                    reason: AdminAuditReason.MANAGER_REQUIRES_ROOT,
                },
            });
        }
    }

    /**
     * Shares live invitation rules and metadata narrowing between preparation and consumption.
     *
     * @param payload Verified invitation identity and deadline
     * @param method Calling workflow for diagnostic context
     * @throws {SystemException} When the account is deleted, differs from the verified subject, or is inactive with an attached avatar
     * @throws {AccessDeniedException} When the account is banned
     * @throws {ResourceConflictException} When the account is already active
     * @throws {InvalidInputException} When the invitation is revoked, mismatched, or expired
     */
    private assertActivationEligibility(
        payload: AdminInvitation,
        method: string,
    ): asserts this is this & {
        readonly isBanned: false;
        readonly inviteId: string;
        readonly inviteExpiresAt: Date;
        readonly inviteRevocationVersion: number;
    } {
        this.assertNotDeleted(method);

        if (payload.sub !== this.id) {
            throw new SystemException('Verified token subject does not match the target account.', {
                context: { class: Admin.name, method: method, id: this.id, sub: payload.sub },
            });
        }

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: AdminAuditAction.ADMIN_ACTIVATION_FAILED,
                    reason: AdminAuditReason.ACCOUNT_BANNED,
                },
            });
        }

        if (this.props.password !== null) {
            throw new ResourceConflictException(ResourceConflictMessage.DEFAULT);
        }

        if (this.props.avatarKey !== null) {
            throw new SystemException('An inactive admin already has an attached avatar.', {
                context: { class: Admin.name, method, id: this.id },
            });
        }

        if (
            payload.jti !== this.props.inviteId ||
            payload.inviteRevocationVersion !== this.revocationVersion ||
            payload.inviteRevocationVersion !== this.props.inviteRevocationVersion ||
            this.props.inviteExpiresAt === null ||
            payload.exp * 1000 !== this.props.inviteExpiresAt.getTime() ||
            this.props.inviteExpiresAt.getTime() <= Date.now()
        ) {
            throw new InvalidInputException(InvalidInputMessage.DEFAULT);
        }
    }

    /**
     * Prevents self-service mutations until password and avatar are attached and narrows their public types.
     *
     * @param method Calling mutation for diagnostic context
     * @throws {SystemException} When the account lacks a password or avatar
     */
    private assertActivated(method: string): asserts this is this & {
        readonly password: string;
        readonly avatarKey: string;
    } {
        if (this.props.password === null) {
            throw new SystemException('An admin without a password reached a self-service flow.', {
                context: { class: Admin.name, method, id: this.id },
            });
        }

        if (this.props.avatarKey === null) {
            throw new SystemException('An admin without an avatar reached a self-service flow.', {
                context: { class: Admin.name, method, id: this.id },
            });
        }
    }

    /**
     * Fixes invitation identity and its three-day lifetime before queuing delivery.
     */
    private issueInvitation() {
        this.props.inviteId = randomUUID();
        this.props.inviteExpiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + INVITATION_LIFETIME_MS);
        this.props.inviteRevocationVersion = this.revocationVersion;
    }

    /**
     * Queues delivery for the current pending invitation.
     *
     * @throws {SystemException} When no pending invitation exists
     */
    private addInvitationJob() {
        if (this.props.inviteId === null) {
            throw new SystemException('Cannot deliver invitation without a pending request.', {
                context: { class: Admin.name, method: this.addInvitationJob.name, id: this.id },
            });
        }

        this.addJob([
            {
                deliveryId: this.props.inviteId,
                aggregateId: this.id,
                queueName: AdminJobQueue.INVITE,
            },
        ]);
    }

    /**
     * Queues initial avatar finalization after invitation acceptance.
     *
     * @param avatarId Avatar identity shared with the delivery
     */
    private addAvatarFinalizeJob(avatarId: string) {
        this.addJob([
            {
                deliveryId: avatarId,
                aggregateId: this.id,
                queueName: AdminJobQueue.AVATAR_FINALIZE,
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
                queueName: AdminJobQueue.AVATAR_REPLACE,
                payload: { previousAvatarId },
            },
        ]);
    }

    /**
     * Raises durable session-version reconciliation for the current admin.
     */
    private addSessionReconciliationJob() {
        this.addJob([
            {
                deliveryId: randomUUID(),
                aggregateId: this.id,
                queueName: AdminJobQueue.SESSION_RECONCILE,
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
     * Supplies the password hash for self-service verification only after activation.
     *
     * @returns The activated account's password hash
     * @throws {SystemException} When the account has not been activated
     */
    get password(): string {
        if (this.props.password === null) {
            throw new SystemException('An inactive admin reached a self-service flow.', {
                context: { class: Admin.name, method: 'password', id: this.id },
            });
        }

        return this.props.password;
    }

    /**
     * Returns the currently selected activation or profile avatar object key.
     *
     * @returns Avatar key, or null before invitation completion
     */
    get avatarKey(): string | null {
        return this.props.avatarKey;
    }

    /**
     * Returns the identity shared with the invitation delivery job.
     *
     * @returns Invitation identifier, or null when no invitation remains
     */
    get inviteId(): string | null {
        return this.props.inviteId;
    }

    /**
     * Returns the fixed invitation expiry.
     *
     * @returns Expiry time, or null when no invitation remains
     */
    get inviteExpiresAt(): Date | null {
        return this.props.inviteExpiresAt;
    }

    /**
     * Returns the account revocation version captured at invitation issuance.
     *
     * @returns Captured revocation version, or null when no invitation remains
     */
    get inviteRevocationVersion(): number | null {
        return this.props.inviteRevocationVersion;
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
        context: { class: Admin.name, method },
    });
}
