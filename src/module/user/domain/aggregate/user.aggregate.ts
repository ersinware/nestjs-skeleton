/**
 * @file user.aggregate.ts
 * @description The User aggregate root — owns the state and invariants of an end-user account.
 */

import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import { PrincipalAggregateRoot, type PermissionChange } from 'src/shared/domain/aggregate-root';
import { DomainEvent } from 'src/shared/domain/event';
import { PrincipalType, type Permission, type Principal } from 'src/shared/domain/principal';

/**
 * The module-owned state of a User aggregate.
 */
type UserProps = {
    email: string;
    name: string;
    password: string;
    isBanned: boolean;
    createdAt: Date;
    updatedAt: Date;
};

/**
 * The full persistable state of a User: the module-owned props plus the identity, deletion
 * timestamp, permissions and session counters owned by the aggregate-root bases. Consumed by
 * reconstitution, produced by {@link User.toSnapshot}.
 */
type UserSnapshot = {
    id: string;
    deletedAt: Date | null;
    permissions: Permission[];
    sessionVersion: number;
    revocationVersion: number;
} & UserProps;

/**
 * The User aggregate root. Owns every user invariant: profile updates, ban/unban transitions,
 * session revocation through the monotonic session-version counter, permission changes, and
 * soft-delete immutability. Administrative mutations take the acting principal only for the base
 * class's universal rule (an admin administers); no rank applies across kinds, since the two never
 * share a permission, so the guard's permission alone decides.
 */
export class User extends PrincipalAggregateRoot {
    protected readonly principalType = PrincipalType.USER;

    private props: UserProps;

    /**
     * Splits the snapshot along the ownership boundary: id, deletedAt, permissions and the session
     * counters go to the aggregate-root bases that own them, the rest becomes the module-owned state.
     *
     * @param snapshot The full aggregate state
     */
    private constructor({ id, deletedAt, permissions, sessionVersion, revocationVersion, ...props }: UserSnapshot) {
        super(id, deletedAt, permissions, sessionVersion, revocationVersion);
        this.props = props;
    }

    /**
     * Creates a new User with a fresh lifecycle state and no permissions.
     *
     * @param props The new identifier plus the initial properties, excluding lifecycle-managed fields
     * @returns The newly created aggregate
     */
    static create(props: { id: string } & Omit<UserProps, 'isBanned' | 'createdAt' | 'updatedAt'>): User {
        const now = new Date();

        return new User({
            ...props,
            isBanned: false,
            deletedAt: null,
            permissions: [],
            sessionVersion: 0,
            revocationVersion: 0,
            createdAt: now,
            updatedAt: now,
        });
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
     */
    toSnapshot(): UserSnapshot {
        return {
            id: this.id,
            deletedAt: this.deletedAt,
            permissions: [...this.permissions],
            sessionVersion: this.sessionVersion,
            revocationVersion: this.revocationVersion,
            ...this.props,
        };
    }

    /**
     * Updates the basic profile information of the user.
     * Only applies changes if the provided values differ from the current state.
     *
     * @returns Whether any field actually changed — the caller records the audit entry only on a real
     * transition, so a request that matched the current state leaves no fabricated trail.
     * @throws {SystemException} When the account has been soft-deleted
     */
    updateProfile(payload: { name?: string; email?: string }): boolean {
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
            this.addDomainEvent(new DomainEvent(UserEvent.UPDATED, this.id));
        }

        return isUpdated;
    }

    /**
     * Changes the user's password and bumps the session version so that every token minted before
     * this change is instantly rejected by the auth guard.
     *
     * @throws {SystemException} When the account has been soft-deleted
     */
    changePassword(password: string) {
        this.assertNotDeleted(this.changePassword.name);

        this.props.password = password;
        this.revokeAllSessions();
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(UserEvent.PASSWORD_CHANGED, this.id));
    }

    /**
     * Replaces the user's permission set, retiring the access tokens that carried the old set while
     * refresh tokens survive to fetch the new one, and emits a PERMISSIONS_CHANGED event. A no-op when the
     * requested set already holds.
     *
     * @param permissions The complete set the user should hold afterwards
     * @param actor The verified principal making the change
     * @returns What was granted and revoked, or null when nothing changed — the caller persists and
     * audits only on a real transition
     * @throws {SystemException} When the account has been soft-deleted
     * @throws {InvalidInputException} When the set holds a permission a user may not hold
     */
    changePermissions(permissions: readonly Permission[], actor: Principal): PermissionChange | null {
        this.assertNotDeleted(this.changePermissions.name);
        this.assertAdministrableBy(actor);

        const change = this.applyPermissions(permissions);

        if (change) {
            this.props.updatedAt = new Date();
            this.addDomainEvent(new DomainEvent(UserEvent.PERMISSIONS_CHANGED, this.id));
        }

        return change;
    }

    /**
     * Bans the user. Bumps the session version to instantly evict existing tokens, and emits a
     * BANNED event. A no-op when the account is already banned.
     *
     * @param actor The verified principal imposing the ban
     * @returns Whether the account actually transitioned — the caller persists, audits, and evicts
     * only on a real ban, so a repeated request triggers none of them.
     * @throws {SystemException} When the account has been soft-deleted
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

        this.addDomainEvent(new DomainEvent(UserEvent.BANNED, this.id));

        return true;
    }

    /**
     * Unbans the user and emits an UNBANNED event. Does not bump the session version — the version is
     * monotonic and re-login mints a token at the current version. A no-op when the account is not
     * banned.
     *
     * @param actor The verified principal lifting the ban
     * @returns Whether the account actually transitioned — the caller persists and audits only on a
     * real unban, so lifting a ban that was never in place triggers neither.
     * @throws {SystemException} When the account has been soft-deleted
     */
    unban(actor: Principal): boolean {
        this.assertNotDeleted(this.unban.name);
        this.assertAdministrableBy(actor);

        if (!this.props.isBanned) {
            return false;
        }

        this.props.isBanned = false;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(UserEvent.UNBANNED, this.id));

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

        this.addDomainEvent(new DomainEvent(UserEvent.SESSIONS_REVOKED, this.id));
    }

    /**
     * Soft deletes the user and bumps the session version for a permanent cut-off, since a deleted
     * account must never be reachable by any previously minted token. Self-service, so it takes no
     * actor: the owner is the only principal that deletes a user account.
     */
    markAsDeleted() {
        if (this.deletedAt) {
            return;
        }

        const now = new Date();

        this.setDeletedAt(now);
        this.props.isBanned = true;
        this.revokeAllSessions();
        this.props.updatedAt = now;

        this.addDomainEvent(new DomainEvent(UserEvent.DELETED, this.id));
    }

    /** The email address. */
    get email(): string {
        return this.props.email;
    }

    /** The display name. */
    get name(): string {
        return this.props.name;
    }

    /** The hashed password. */
    get password(): string {
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
