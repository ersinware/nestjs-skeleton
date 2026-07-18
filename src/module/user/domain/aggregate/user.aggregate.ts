/**
 * @file user.aggregate.ts
 * @description The User Aggregate Root. Encapsulates all business rules and state for a User.
 */

import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import { AggregateRoot } from 'src/shared/domain/aggregate-root';
import { DomainEvent } from 'src/shared/domain/event';

export interface UserProps {
    email: string;
    name: string;
    password: string;
    isBanned: boolean;
    deletedAt: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export class User extends AggregateRoot {
    private props: UserProps;

    private constructor(id: string, props: UserProps) {
        super(id);
        this.props = props;
    }

    /**
     * Factory method to create a new User.
     * Enforces invariant rules on creation and emits a CREATED event.
     */
    static create(
        id: string,
        props: Omit<UserProps, 'isBanned' | 'deletedAt' | 'version' | 'createdAt' | 'updatedAt'>,
    ): User {
        const now = new Date(),
            user = new User(id, {
                ...props,
                isBanned: false,
                deletedAt: null,
                version: 0,
                createdAt: now,
                updatedAt: now,
            });

        return user;
    }

    /**
     * Factory method to reconstitute an existing User from the database.
     */
    static reconstitute(id: string, props: UserProps): User {
        return new User(id, props);
    }

    /**
     * Creates a snapshot of the aggregate state for persistence.
     */
    toSnapshot(): UserProps & { id: string } {
        return {
            id: this.id,
            ...this.props,
        };
    }

    /**
     * Updates the basic profile information of the user.
     * Only applies changes if the provided values differ from the current state.
     */
    updateProfile(payload: { name?: string | undefined; email?: string | undefined }) {
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
    }

    /**
     * Changes the user's password and bumps the session version so that every token minted before
     * this change is instantly rejected by the auth guard.
     */
    changePassword(password: string) {
        this.props.password = password;
        this.props.version++;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(UserEvent.PASSWORD_CHANGED, this.id));
    }

    /**
     * Bans the user. Bumps the session version to instantly evict existing tokens, and emits a
     * BANNED event. A no-op when the account is already banned.
     */
    ban(): void {
        if (this.props.isBanned) {
            return;
        }

        this.props.isBanned = true;
        this.props.version++;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(UserEvent.BANNED, this.id));
    }

    /**
     * Unbans the user and emits an UNBANNED event. Does not bump the session version — the version is
     * monotonic and re-login mints a token at the current version. A no-op when the account is not
     * banned.
     */
    unban(): void {
        if (!this.props.isBanned) {
            return;
        }

        this.props.isBanned = false;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(UserEvent.UNBANNED, this.id));
    }

    /**
     * Revokes every active session after refresh-token reuse was detected for this account. Bumps the
     * session version so all outstanding access and refresh tokens are instantly rejected, and emits a
     * SESSION_REUSE_REVOKED event. Deliberately does NOT ban: the credentials are still valid, so the
     * owner can simply sign back in (and is separately advised, not forced, to change their password).
     */
    revokeSessions(): void {
        this.props.version++;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(UserEvent.SESSION_REUSE_REVOKED, this.id));
    }

    /**
     * Soft deletes the user and bumps the session version for a permanent cut-off, since a deleted
     * account must never be reachable by any previously minted token.
     */
    markAsDeleted(): void {
        if (this.props.deletedAt) {
            return;
        }

        const now = new Date();
        this.props.deletedAt = now;
        this.props.isBanned = true;
        this.props.version++;
        this.props.updatedAt = now;

        this.addDomainEvent(new DomainEvent(UserEvent.DELETED, this.id));
    }

    get email(): string {
        return this.props.email;
    }

    get name(): string {
        return this.props.name;
    }

    get password(): string {
        return this.props.password;
    }

    get isBanned(): boolean {
        return this.props.isBanned;
    }

    get deletedAt(): Date | null {
        return this.props.deletedAt;
    }

    get version(): number {
        return this.props.version;
    }

    get createdAt(): Date {
        return this.props.createdAt;
    }

    get updatedAt(): Date {
        return this.props.updatedAt;
    }
}
