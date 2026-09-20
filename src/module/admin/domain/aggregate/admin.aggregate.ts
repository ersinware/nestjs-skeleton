/**
 * @file admin.aggregate.ts
 * @description Defines the state and invariants of an admin account.
 */

import { randomUUID } from 'node:crypto';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { PrincipalAggregateRoot, type PermissionChange } from 'src/shared/domain/aggregate-root';
import { Permission, PrincipalType, SessionRevocationReason, type Principal } from 'src/shared/domain/principal';
import { AccessDeniedException, ResourceConflictException, SystemException } from 'src/shared/exception';

/**
 * The module-owned state of an Admin aggregate.
 */
type AdminProps = {
    email: string;
    name: string;
    //  Null until the invited admin activates the account.
    password: string | null;
    isBanned: boolean;
    createdAt: Date;
    updatedAt: Date;
};

/**
 * Persistable state of an Admin aggregate.
 */
type AdminSnapshot = {
    readonly id: string;
    readonly version: number;
    readonly deletedAt: Date | null;
    readonly permissions: readonly Permission[];
    readonly sessionVersion: number;
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
    static create(
        props: { readonly id: string } & Readonly<Omit<AdminProps, 'isBanned' | 'createdAt' | 'updatedAt'>>,
    ): Admin {
        const now = new Date(),
            admin = new Admin({
                ...props,
                isBanned: false,
                version: 0,
                deletedAt: null,
                permissions: [],
                sessionVersion: 0,
                revocationVersion: 0,
                createdAt: now,
                updatedAt: now,
            });

        if (!props.password) {
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
        this.addInvitationJob();
    }

    /**
     * Activates a pending admin by setting its first password.
     *
     * @param password The Argon2-hashed initial password
     * @throws {SystemException} When the account is soft-deleted or already active
     */
    activate(password: string) {
        this.assertNotDeleted(this.activate.name);

        if (this.props.password !== null) {
            throw new SystemException('An already-active account cannot be activated again.', {
                context: { class: Admin.name, method: this.activate.name, id: this.id },
            });
        }

        this.props.password = password;
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
     * Raises durable invitation delivery for the current admin.
     */
    private addInvitationJob() {
        this.addJob([
            {
                deliveryId: randomUUID(),
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
