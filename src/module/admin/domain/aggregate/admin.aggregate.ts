/**
 * @file admin.aggregate.ts
 * @description Defines the state and invariants of an admin account.
 */

import { randomUUID } from 'node:crypto';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { PrincipalAggregateRoot, type PermissionChange } from 'src/shared/domain/aggregate-root';
import { Permission, PrincipalType, SessionRevocationReason, type Principal } from 'src/shared/domain/principal';
import {
    AccessDeniedException,
    InvalidInputException,
    ResourceConflictException,
    SystemException,
} from 'src/shared/exception';

/**
 * Pending admin invitations remain valid for three days from issuance.
 */
const INVITATION_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;

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
     * Fixed JWT issuance time, at whole-second precision.
     */
    inviteIssuedAt: Date | null;

    /**
     * Fixed JWT expiry, cleared when the invitation is consumed.
     */
    inviteExpiresAt: Date | null;

    /**
     * Account revocation version captured when the invitation is issued.
     */
    inviteRevocationVersion: number | null;

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
                inviteIssuedAt: null,
                inviteExpiresAt: null,
                inviteRevocationVersion: null,
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
     * Applies changed profile fields.
     *
     * @param payload Profile fields to update
     * @returns Whether any field changed
     * @throws {SystemException} When the account has been soft-deleted
     */
    updateProfile(payload: { readonly name?: string; readonly email?: string }): boolean {
        this.assertNotDeleted(this.updateProfile.name);

        let isUpdated = false;

        if (payload.name && payload.name !== this.props.name) {
            this.props.name = payload.name;
            isUpdated = true;
        }

        if (payload.email && payload.email !== this.props.email) {
            this.props.email = payload.email;
            isUpdated = true;
        }

        if (isUpdated) {
            this.props.updatedAt = new Date();
        }

        return isUpdated;
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
     * Activates a pending admin by setting its first password.
     *
     * @param password The Argon2-hashed initial password
     * @param inviteId Identity from the invitation already matched to this aggregate by the caller
     * @throws {SystemException} When the account is deleted or the caller bypassed activation prechecks
     * @throws {InvalidInputException} When the invitation expired after the caller's prechecks
     */
    activate(password: string, inviteId: string) {
        this.assertNotDeleted(this.activate.name);

        if (
            this.props.password !== null ||
            this.props.isBanned ||
            this.props.inviteId !== inviteId ||
            this.props.inviteExpiresAt === null ||
            this.props.inviteRevocationVersion !== this.revocationVersion
        ) {
            throw new SystemException('Activation requires a pending, eligible account and a matching invitation.', {
                context: { class: Admin.name, method: this.activate.name, id: this.id },
            });
        }

        // Time can advance during password hashing even though this aggregate's state is unchanged.
        if (this.props.inviteExpiresAt.getTime() <= Date.now()) {
            throw new InvalidInputException();
        }

        this.props.password = password;
        this.props.inviteId = null;
        this.props.inviteIssuedAt = null;
        this.props.inviteExpiresAt = null;
        this.props.inviteRevocationVersion = null;
        this.props.updatedAt = new Date();
    }

    /**
     * Changes the password and revokes existing sessions.
     *
     * @param password Argon2 password hash
     * @throws {SystemException} When the account has been soft-deleted
     */
    changePassword(password: string) {
        this.assertNotDeleted(this.changePassword.name);

        this.props.password = password;
        this.revokeAllSessions();
        this.props.updatedAt = new Date();

        this.addSessionReconciliationJob();
    }

    /**
     * Replaces permissions and retires access tokens carrying the previous set.
     *
     * @param permissions The complete set the admin should hold afterwards
     * @param actor The verified principal making the change
     * @returns Granted and revoked permissions, or null when unchanged
     * @throws {SystemException} When the account has been soft-deleted
     * @throws {AccessDeniedException} When the actor or requested hierarchy change is forbidden
     * @throws {InvalidInputException} When the set holds a permission an admin may not hold
     */
    changePermissions(permissions: readonly Permission[], actor: Principal): PermissionChange | null {
        this.assertNotDeleted(this.changePermissions.name);
        this.assertAdministrableBy(actor);

        // Root is provisioned outside this mutation and cannot be granted.
        if (permissions.includes(Permission.ADMIN_ROOT)) {
            throw new AccessDeniedException('The root permission is held by exactly one account and is never granted.');
        }

        // Only root may appoint a permission manager.
        if (
            permissions.includes(Permission.ADMIN_PERMISSION_MANAGE) &&
            !actor.permissions.includes(Permission.ADMIN_ROOT)
        ) {
            throw new AccessDeniedException('Only root may appoint a permission manager.');
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
     * @throws {SystemException} When the account has been soft-deleted
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
     * @throws {SystemException} When the account has been soft-deleted
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
     * Fixes invitation identity and its three-day lifetime before queuing delivery.
     */
    private issueInvitation() {
        const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000);

        this.props.inviteId = randomUUID();
        this.props.inviteIssuedAt = issuedAt;
        this.props.inviteExpiresAt = new Date(issuedAt.getTime() + INVITATION_LIFETIME_MS);
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
     * Enforces self, root, and permission-manager administration restrictions.
     *
     * @param actor The verified principal performing the administration
     * @throws {SystemException} When a non-admin actor reaches the mutation
     * @throws {AccessDeniedException} When the actor cannot administer the target
     */
    protected override assertAdministrableBy(actor: Principal) {
        super.assertAdministrableBy(actor);

        if (actor.id === this.id) {
            throw new AccessDeniedException('An admin cannot administer their own account.');
        }

        if (this.permissions.includes(Permission.ADMIN_ROOT)) {
            throw new AccessDeniedException('The root account cannot be administered.');
        }

        if (
            this.permissions.includes(Permission.ADMIN_PERMISSION_MANAGE) &&
            !actor.permissions.includes(Permission.ADMIN_ROOT)
        ) {
            throw new AccessDeniedException('A permission manager is administered by root alone.');
        }
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
     * Returns the password hash, or null while activation is pending.
     *
     * @returns Password hash or null
     */
    get password(): string | null {
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
     * Returns the fixed invitation issuance time.
     *
     * @returns Issuance time at whole-second precision, or null when no invitation remains
     */
    get inviteIssuedAt(): Date | null {
        return this.props.inviteIssuedAt;
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
