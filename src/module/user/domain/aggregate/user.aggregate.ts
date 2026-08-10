/**
 * @file user.aggregate.ts
 * @description The User Aggregate Root. Encapsulates all business rules and state for a User.
 */

import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import { SoftDeletableAggregateRoot } from 'src/shared/domain/aggregate-root';
import { DomainEvent } from 'src/shared/domain/event';

/**
 * Properties that define the state of a User aggregate.
 */
type UserProps = {
    email: string;
    name: string;
    password: string;
    isBanned: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
};

/**
 * The full persistable state of a User: the module-owned props plus the identity and deletion
 * timestamp owned by the aggregate-root bases. The shape both reconstitution consumes and
 * {@link User.toSnapshot} produces.
 */
type UserSnapshot = { id: string; deletedAt: Date | null } & UserProps;

/**
 * The User aggregate root.
 * Encapsulates the core rules, state, and behaviors of an end user.
 */
export class User extends SoftDeletableAggregateRoot {
    private props: UserProps;

    /**
     * Initializes a new instance of the User aggregate. Splits the snapshot along the ownership
     * boundary: id and deletedAt go to the aggregate-root bases that own them, the rest is stored as
     * the module-owned state.
     *
     * @param snapshot The full aggregate state, including the base-owned identity and deletion timestamp
     */
    private constructor({ id, deletedAt, ...props }: UserSnapshot) {
        super(id, deletedAt);
        this.props = props;
    }

    /**
     * Factory method to create a new User with a fresh lifecycle state.
     *
     * @param props The new unique identifier plus the initial properties, excluding managed fields
     * @returns The newly created aggregate
     */
    static create(props: { id: string } & Omit<UserProps, 'isBanned' | 'version' | 'createdAt' | 'updatedAt'>): User {
        const now = new Date();

        return new User({
            ...props,
            isBanned: false,
            deletedAt: null,
            version: 0,
            createdAt: now,
            updatedAt: now,
        });
    }

    /**
     * Factory method to reconstitute an existing User from the database.
     *
     * @param snapshot The persisted aggregate state, including the identity and deletion timestamp
     * @returns The reconstituted aggregate
     */
    static reconstitute(snapshot: UserSnapshot): User {
        return new User(snapshot);
    }

    /**
     * Creates a snapshot of the aggregate state for persistence: the module-owned props plus the
     * identity and deletion timestamp owned by the aggregate-root bases.
     */
    toSnapshot(): UserSnapshot {
        return {
            id: this.id,
            deletedAt: this.deletedAt,
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
        this.props.version++;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(UserEvent.PASSWORD_CHANGED, this.id));
    }

    /**
     * Bans the user. Bumps the session version to instantly evict existing tokens, and emits a
     * BANNED event. A no-op when the account is already banned.
     *
     * @returns Whether the account actually transitioned — the caller persists, audits, and evicts
     * only on a real ban, so a repeated request triggers none of them.
     * @throws {SystemException} When the account has been soft-deleted
     */
    ban(): boolean {
        this.assertNotDeleted(this.ban.name);

        if (this.props.isBanned) {
            return false;
        }

        this.props.isBanned = true;
        this.props.version++;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(UserEvent.BANNED, this.id));

        return true;
    }

    /**
     * Unbans the user and emits an UNBANNED event. Does not bump the session version — the version is
     * monotonic and re-login mints a token at the current version. A no-op when the account is not
     * banned.
     *
     * @returns Whether the account actually transitioned — the caller persists and audits only on a
     * real unban, so lifting a ban that was never in place triggers neither.
     * @throws {SystemException} When the account has been soft-deleted
     */
    unban(): boolean {
        this.assertNotDeleted(this.unban.name);

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

        this.props.version++;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(UserEvent.SESSIONS_REVOKED, this.id));
    }

    /**
     * Soft deletes the user and bumps the session version for a permanent cut-off, since a deleted
     * account must never be reachable by any previously minted token.
     */
    markAsDeleted() {
        if (this.deletedAt) {
            return;
        }

        const now = new Date();
        this.setDeletedAt(now);
        this.props.isBanned = true;
        this.props.version++;
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

    /** The monotonic session-version counter. */
    get version(): number {
        return this.props.version;
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
