/**
 * @file admin.aggregate.ts
 * @description Defines the state and invariants of an admin account.
 */

import { randomUUID } from 'node:crypto';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { PrincipalAggregateRoot, type PermissionChange } from 'src/shared/domain/aggregate-root';
import { DomainFailureAuditAction } from 'src/shared/domain/audit';
import { Permission, PrincipalType, SessionRevocationReason, type Principal } from 'src/shared/domain/principal';
import { isUUIDV7 } from 'src/shared/domain/uuid';
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
 * Account-owned administrative refusal reasons preserved in audit evidence.
 */
enum AdminAdministrationRejectionReason {
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
}

/**
 * Account-owned activation refusal reasons; only their string values leave the aggregate.
 */
enum ActivateAdminRejectionReason {
    /**
     * The account is banned from activation.
     */
    ACCOUNT_BANNED = 'ACCOUNT_BANNED',
}

/**
 * Pending admin invitations remain valid for three days from issuance.
 */
const INVITATION_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Account-owned email confirmation refusals; handling boundaries consume their audit reasons.
 */
enum ConfirmEmailChangeRejectionReason {
    /**
     * The account is banned from email changes.
     */
    ACCOUNT_BANNED = 'ACCOUNT_BANNED',
}

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
    static create(props: { readonly id: string } & Readonly<Pick<AdminProps, 'email' | 'name' | 'password'>>): Admin {
        const now = new Date(),
            admin = new Admin({
                ...props,
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

        if (this.props.password !== null) {
            throw new ResourceConflictException('The account has already been activated.');
        }

        if (this.props.isBanned) {
            throw new ResourceConflictException('A banned account cannot be re-invited.');
        }

        this.revokeAllSessions();
        this.props.updatedAt = new Date();
        this.issueInvitation();
    }

    /**
     * Activates a pending admin after checking account and invitation eligibility.
     *
     * @param password The Argon2-hashed initial password
     * @param payload Identity and timing claims from the verified invitation
     * @throws {SystemException} When the account is deleted or differs from the token subject
     * @throws {AccessDeniedException} When the account is banned
     * @throws {ResourceConflictException} When the account is already active
     * @throws {InvalidInputException} When the invitation is revoked, mismatched, or expired
     */
    activate(
        password: string,
        payload: {
            readonly sub: string;
            readonly jti: string;
            readonly inviteRevocationVersion: number;
            readonly exp: number;
        },
    ) {
        this.assertNotDeleted(this.activate.name);

        if (payload.sub !== this.id) {
            throw new SystemException('Verified token subject does not match the target account.', {
                context: { class: Admin.name, method: this.activate.name, id: this.id, sub: payload.sub },
            });
        }

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: DomainFailureAuditAction.ADMIN_ACTIVATION_FAILED,
                    reason: ActivateAdminRejectionReason.ACCOUNT_BANNED,
                },
            });
        }

        if (this.props.password !== null) {
            throw new ResourceConflictException(ResourceConflictMessage.DEFAULT);
        }

        if (payload.inviteRevocationVersion !== this.revocationVersion) {
            throw new InvalidInputException(InvalidInputMessage.DEFAULT);
        }

        if (
            payload.jti !== this.props.inviteId ||
            payload.inviteRevocationVersion !== this.props.inviteRevocationVersion ||
            this.props.inviteExpiresAt === null ||
            payload.exp * 1000 !== this.props.inviteExpiresAt.getTime()
        ) {
            throw new InvalidInputException(InvalidInputMessage.DEFAULT);
        }

        if (this.props.inviteExpiresAt.getTime() <= Date.now()) {
            throw new InvalidInputException(InvalidInputMessage.DEFAULT);
        }

        this.props.password = password;
        this.props.inviteId = null;
        this.props.inviteExpiresAt = null;
        this.props.inviteRevocationVersion = null;
        this.props.updatedAt = new Date();
    }

    /**
     * Updates an activated admin's display name when it differs from the current state.
     *
     * @param name The new display name
     * @returns Whether the name changed
     * @throws {SystemException} When the account is deleted or has not been activated
     */
    updateName(name: string): boolean {
        this.assertNotDeleted(this.updateName.name);

        if (this.props.password === null) {
            throw new SystemException('An inactive admin reached the profile update flow.', {
                context: { class: Admin.name, method: this.updateName.name, id: this.id },
            });
        }

        if (name === this.props.name) {
            return false;
        }

        this.props.name = name;
        this.props.updatedAt = new Date();

        return true;
    }

    /**
     * Changes the password and revokes existing sessions.
     *
     * @param password Replacement password hash
     * @param currentPasswordMatches Whether the submitted current password matches the loaded hash
     * @param newPasswordMatchesCurrent Whether the proposed new password matches that same hash
     * @throws {SystemException} When the account is deleted or has not been activated
     * @throws {AccessDeniedException} When the account is banned
     * @throws {InvalidInputException} When the current password is wrong or the new password is unchanged
     */
    changePassword(password: string, currentPasswordMatches: boolean, newPasswordMatchesCurrent: boolean) {
        this.assertNotDeleted(this.changePassword.name);

        if (this.props.password === null) {
            throw new SystemException('An inactive admin reached the password change flow.', {
                context: { class: Admin.name, method: this.changePassword.name, id: this.id },
            });
        }

        if (this.props.isBanned) {
            throw new AccessDeniedException();
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
     * @throws {SystemException} When the account is deleted or has not been activated
     * @throws {AccessDeniedException} When the account is banned
     * @throws {InvalidInputException} When the current password is wrong or the address is unchanged
     * @throws {ResourceConflictException} When the target address is already in use
     */
    requestEmailChange(newEmail: string, currentPasswordMatches: boolean, emailInUse: boolean) {
        this.assertNotDeleted(this.requestEmailChange.name);

        if (this.props.password === null) {
            throw new SystemException('An inactive admin reached the email change request flow.', {
                context: { class: Admin.name, method: this.requestEmailChange.name, id: this.id },
            });
        }

        if (this.props.isBanned) {
            throw new AccessDeniedException();
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
     * @throws {SystemException} When the account is deleted, inactive, differs from the token subject, or the notification ID is invalid
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

        if (!isUUIDV7(notificationId)) {
            throw new SystemException('Invalid email change notification ID.', {
                context: { class: Admin.name, method: this.confirmEmailChange.name, id: this.id },
            });
        }

        if (payload.sub !== this.id) {
            throw new SystemException('Verified token subject does not match the target account.', {
                context: { class: Admin.name, method: this.confirmEmailChange.name, id: this.id, sub: payload.sub },
            });
        }

        if (this.props.password === null) {
            throw new SystemException('An inactive admin reached the email confirmation flow.', {
                context: { class: Admin.name, method: this.confirmEmailChange.name, id: this.id },
            });
        }

        if (this.props.isBanned) {
            throw new AccessDeniedException(AccessDeniedMessage.DEFAULT, {
                audit: {
                    action: DomainFailureAuditAction.EMAIL_CHANGE_CONFIRMATION_FAILED,
                    reason: ConfirmEmailChangeRejectionReason.ACCOUNT_BANNED,
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
            payload.exp * 1000 !== this.props.pendingEmailExpiresAt.getTime()
        ) {
            throw new InvalidInputException(InvalidInputMessage.DEFAULT);
        }

        if (this.props.pendingEmailExpiresAt.getTime() <= Date.now()) {
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
                        action: DomainFailureAuditAction.ADMIN_ADMINISTRATION_DENIED,
                        reason: AdminAdministrationRejectionReason.ROOT_PERMISSION_GRANT_FORBIDDEN,
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
                    action: DomainFailureAuditAction.ADMIN_ADMINISTRATION_DENIED,
                    reason: AdminAdministrationRejectionReason.MANAGER_APPOINTMENT_REQUIRES_ROOT,
                },
            });
        }

        const change = this.applyPermissions(permissions);

        if (change) {
            this.props.updatedAt = new Date();
            this.addSessionReconciliationJob();
        }

        return change;
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
     * Revokes all sessions and raises reason-specific follow-up jobs without banning the admin.
     *
     * @param reason Why every session is being revoked
     * @throws {SystemException} When the account has been soft-deleted
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
     * Soft-deletes and bans the admin, then revokes existing sessions.
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
        this.props.isBanned = true;
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
                    action: DomainFailureAuditAction.ADMIN_ADMINISTRATION_DENIED,
                    reason: AdminAdministrationRejectionReason.SELF_TARGET,
                },
            });
        }

        if (this.permissions.includes(Permission.ADMIN_ROOT)) {
            throw new AccessDeniedException('The root account cannot be administered.', {
                audit: {
                    action: DomainFailureAuditAction.ADMIN_ADMINISTRATION_DENIED,
                    reason: AdminAdministrationRejectionReason.ROOT_TARGET,
                },
            });
        }

        if (
            this.permissions.includes(Permission.ADMIN_PERMISSION_MANAGE) &&
            !actor.permissions.includes(Permission.ADMIN_ROOT)
        ) {
            throw new AccessDeniedException('A permission manager is administered by root alone.', {
                audit: {
                    action: DomainFailureAuditAction.ADMIN_ADMINISTRATION_DENIED,
                    reason: AdminAdministrationRejectionReason.MANAGER_REQUIRES_ROOT,
                },
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

        this.addJob([
            {
                deliveryId: this.props.inviteId,
                aggregateId: this.id,
                queueName: AdminJobQueue.INVITE,
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
