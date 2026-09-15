/**
 * @file admin.aggregate.ts
 * @description The Admin aggregate root — owns the state and invariants of an admin account.
 */

import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import { PrincipalAggregateRoot, type PermissionChange } from 'src/shared/domain/aggregate-root';
import { DomainEvent } from 'src/shared/domain/event';
import { Permission, PrincipalType, type Principal } from 'src/shared/domain/principal';
import { AccessDeniedException, ResourceConflictException, SystemException } from 'src/shared/exception';

/**
 * The module-owned state of an Admin aggregate.
 */
type AdminProps = {
    email: string;
    name: string;
    /** Null until the invited admin activates the account by setting a password. */
    password: string | null;
    isBanned: boolean;
    createdAt: Date;
    updatedAt: Date;
};

/**
 * The full persistable state of an Admin: the module-owned props plus the identity, persistence
 * version, deletion timestamp, permissions and session counters owned by the aggregate-root bases. Consumed by
 * reconstitution, produced by {@link Admin.toSnapshot}.
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
 * The Admin aggregate root. Owns every admin invariant: profile updates, ban/unban transitions,
 * session revocation through the monotonic version counter, permission changes, soft-delete
 * immutability, and the administration hierarchy among admins.
 *
 * The hierarchy has three tiers. ROOT (one account, `admin:root`) appoints and dismisses MANAGERS
 * (the manage permission) and may administer anyone; nobody administers root. A manager
 * administers ORDINARY admins only — gives and takes every ordinary permission, bans, deletes; a
 * manager is administered by root alone, in every respect. Nobody administers their own account.
 * Every administrative mutation takes the acting principal so these rules can decide.
 */
export class Admin extends PrincipalAggregateRoot {
    protected readonly principalType = PrincipalType.ADMIN;

    private props: AdminProps;

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
    }: AdminSnapshot) {
        super(id, version, deletedAt, permissions, sessionVersion, revocationVersion);
        this.props = props;
    }

    /**
     * Creates a new Admin with a fresh lifecycle state and no permissions — authority is granted
     * afterwards, by an admin who holds it. A passwordless account is pending activation and emits
     * an INVITED event; one created with a password is active from the start and emits nothing.
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
            admin.addDomainEvent(new DomainEvent(AdminEvent.INVITED, admin.id));
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
     * Returns the full aggregate state for persistence.
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
     * Updates the basic profile information of the admin.
     * Only applies changes if the provided values differ from the current state.
     *
     * @returns Whether any field actually changed — the caller records the audit entry only on a real
     * transition, so a request that matched the current state leaves no fabricated trail.
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
     * Invalidates earlier invitations before requesting a replacement for a pending account.
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
        this.addDomainEvent(new DomainEvent(AdminEvent.INVITED, this.id));
    }

    /**
     * Activates a pending account by setting its first password. The transition itself spends the
     * invitation: once a password exists, every outstanding invite token is rejected.
     *
     * @param password The Argon2-hashed initial password
     * @throws {SystemException} When the account is soft-deleted or already active — the activation
     * flow filters both, so reaching either here is a broken code path
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
     * Changes the admin's password and bumps the session version so that every token minted before
     * this change is instantly rejected by the auth guard.
     *
     * @throws {SystemException} When the account has been soft-deleted
     */
    changePassword(password: string) {
        this.assertNotDeleted(this.changePassword.name);

        this.props.password = password;
        this.revokeAllSessions();
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(AdminEvent.PASSWORD_CHANGED, this.id));
    }

    /**
     * Replaces the admin's permission set, retiring the access tokens that carried the old set while
     * refresh tokens survive to fetch the new one, and emits a PERMISSIONS_CHANGED event. A no-op when the
     * requested set already holds.
     *
     * @param permissions The complete set the admin should hold afterwards
     * @param actor The verified principal making the change
     * @returns What was granted and revoked, or null when nothing changed — the caller persists and
     * audits only on a real transition
     * @throws {SystemException} When the account has been soft-deleted
     * @throws {AccessDeniedException} When the actor targets themselves or root, or a manager without being root, grants the root marker, or appoints a manager without being root
     * @throws {InvalidInputException} When the set holds a permission an admin may not hold
     */
    changePermissions(permissions: readonly Permission[], actor: Principal): PermissionChange | null {
        this.assertNotDeleted(this.changePermissions.name);
        this.assertAdministrableBy(actor);

        // Root is never in a requested set: the root account itself is not administrable, so a set
        // carrying the marker can only be an attempt to grant it.
        if (permissions.includes(Permission.ADMIN_ROOT)) {
            throw new AccessDeniedException('The root permission is held by exactly one account and is never granted.');
        }

        // A set carrying the manage marker is root's alone: from a non-root actor it is either an
        // appointment, or a change on a manager that assertAdministrableBy refused already.
        if (
            permissions.includes(Permission.ADMIN_PERMISSION_MANAGE) &&
            !actor.permissions.includes(Permission.ADMIN_ROOT)
        ) {
            throw new AccessDeniedException('Only root may appoint a permission manager.');
        }

        const change = this.applyPermissions(permissions);

        if (change) {
            this.props.updatedAt = new Date();
            this.addDomainEvent(new DomainEvent(AdminEvent.PERMISSIONS_CHANGED, this.id));
        }

        return change;
    }

    /**
     * Bans the admin. Bumps the session version to instantly evict existing tokens, and emits a
     * BANNED event. A no-op when the account is already banned.
     *
     * @param actor The verified principal imposing the ban
     * @returns Whether the account actually transitioned — the caller persists, audits, and evicts
     * only on a real ban, so a repeated request triggers none of them.
     * @throws {SystemException} When the account has been soft-deleted
     * @throws {AccessDeniedException} When the actor targets themselves or root, or a manager without being root
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

        this.addDomainEvent(new DomainEvent(AdminEvent.BANNED, this.id));

        return true;
    }

    /**
     * Unbans the admin without bumping the session version — the version is
     * monotonic and re-login mints a token at the current version. A no-op when the account is not
     * banned.
     *
     * @param actor The verified principal lifting the ban
     * @returns Whether the account actually transitioned — the caller persists and audits only on a
     * real unban, so lifting a ban that was never in place triggers neither.
     * @throws {SystemException} When the account has been soft-deleted
     * @throws {AccessDeniedException} When the actor targets themselves or root, or a manager without being root
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
     * Revokes every active session after refresh-token reuse was detected for this account. Bumps the
     * session version so all outstanding access and refresh tokens are instantly rejected, and emits a
     * SESSIONS_REVOKED event. Deliberately does NOT ban: the credentials are still valid, so the
     * owner can simply sign back in (and is separately advised, not forced, to change their password).
     *
     * @throws {SystemException} When the account has been soft-deleted
     */
    revokeSessions() {
        this.assertNotDeleted(this.revokeSessions.name);

        this.revokeAllSessions();
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(AdminEvent.SESSIONS_REVOKED, this.id));
    }

    /**
     * Soft-deletes the admin account: sets the deletion timestamp, bans the account, bumps the
     * session version for a permanent cut-off, and emits a DELETED event. A no-op when already
     * deleted.
     *
     * @param actor The verified principal deleting the account
     * @throws {AccessDeniedException} When the actor targets themselves or root, or a manager without being root
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

        this.addDomainEvent(new DomainEvent(AdminEvent.DELETED, this.id));
    }

    /**
     * Refines the universal rule with the rank hierarchy: never one's own account; never root; a
     * manager by root alone — managers hold no rank over each other, so the only answer to one
     * administering another is root.
     *
     * @param actor The verified principal performing the administration
     * @throws {SystemException} When a non-admin actor reaches the mutation
     * @throws {AccessDeniedException} When the actor targets themselves, root, or a manager without being root
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

    /** The email address. */
    get email(): string {
        return this.props.email;
    }

    /** The display name. */
    get name(): string {
        return this.props.name;
    }

    /** The hashed password, or null while the account is pending activation. */
    get password(): string | null {
        return this.props.password;
    }

    /** Whether the account is banned. */
    get isBanned(): boolean {
        return this.props.isBanned;
    }

    /** The creation timestamp. */
    get createdAt(): Date {
        return this.props.createdAt;
    }

    /** The last-update timestamp. */
    get updatedAt(): Date {
        return this.props.updatedAt;
    }
}
