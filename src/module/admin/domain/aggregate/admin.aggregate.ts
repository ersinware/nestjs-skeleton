/**
 * @file admin.aggregate.ts
 * @description The Admin Aggregate Root. Encapsulates all business rules and state for an Admin.
 */

import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import { AdminRole } from 'src/shared/domain/admin';
import { SoftDeletableAggregateRoot } from 'src/shared/domain/aggregate-root';
import { DomainEvent } from 'src/shared/domain/event';

/**
 * Properties that define the state of an Admin aggregate.
 */
type AdminProps = {
    email: string;
    name: string;
    password: string;
    role: AdminRole;
    isBanned: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
};

/**
 * The Admin aggregate root.
 * Encapsulates the core rules, state, and behaviors of an administrative user.
 */
export class Admin extends SoftDeletableAggregateRoot {
    private props: AdminProps;

    /**
     * Initializes a new instance of the Admin aggregate.
     *
     * @param id The unique identifier
     * @param deletedAt The soft-deletion timestamp, or null while the account is live
     * @param props The aggregate state properties
     */
    private constructor(id: string, deletedAt: Date | null, props: AdminProps) {
        super(id, deletedAt);
        this.props = props;
    }

    /**
     * Factory method to create a new Admin.
     * Enforces invariant rules on creation and emits a CREATED event.
     *
     * @param id The new unique identifier
     * @param props The initial properties excluding managed fields
     * @returns The newly created aggregate
     */
    static create(id: string, props: Omit<AdminProps, 'isBanned' | 'version' | 'createdAt' | 'updatedAt'>): Admin {
        const now = new Date();

        const admin = new Admin(id, null, {
            ...props,
            isBanned: false,
            version: 0,
            createdAt: now,
            updatedAt: now,
        });

        admin.addDomainEvent(new DomainEvent(AdminEvent.CREATED, id));

        return admin;
    }

    /**
     * Factory method to reconstitute an existing Admin from the database.
     *
     * @param id The unique identifier
     * @param deletedAt The persisted soft-deletion timestamp, or null while the account is live
     * @param props The persisted aggregate state
     * @returns The reconstituted aggregate
     */
    static reconstitute(id: string, deletedAt: Date | null, props: AdminProps): Admin {
        return new Admin(id, deletedAt, props);
    }

    /**
     * Creates a snapshot of the aggregate state for persistence: the module-owned props plus the
     * identity and deletion timestamp owned by the aggregate-root bases.
     */
    toSnapshot(): { id: string; deletedAt: Date | null } & AdminProps {
        return {
            id: this.id,
            deletedAt: this.deletedAt,
            ...this.props,
        };
    }

    /**
     * Bans the admin. Bumps the session version to instantly evict existing tokens, and emits a
     * BANNED event. A no-op when the account is already banned.
     *
     * @throws {SystemException} When the account has been soft-deleted
     */
    ban() {
        this.assertNotDeleted(this.ban.name);

        if (this.props.isBanned) {
            return;
        }

        this.props.isBanned = true;
        this.props.version++;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(AdminEvent.BANNED, this.id));
    }

    /**
     * Unbans the admin and emits an UNBANNED event. Does not bump the session version — the version is
     * monotonic and re-login mints a token at the current version. A no-op when the account is not
     * banned.
     *
     * @throws {SystemException} When the account has been soft-deleted
     */
    unban() {
        this.assertNotDeleted(this.unban.name);

        if (!this.props.isBanned) {
            return;
        }

        this.props.isBanned = false;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(AdminEvent.UNBANNED, this.id));
    }

    /**
     * Revokes every active session after refresh-token reuse was detected for this account. Bumps the
     * session version so all outstanding access and refresh tokens are instantly rejected, and emits a
     * SESSION_REUSE_REVOKED event. Deliberately does NOT ban: the credentials are still valid, so the
     * owner can simply sign back in (and is separately advised, not forced, to change their password).
     *
     * @throws {SystemException} When the account has been soft-deleted
     */
    revokeSessions() {
        this.assertNotDeleted(this.revokeSessions.name);

        this.props.version++;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(AdminEvent.SESSION_REUSE_REVOKED, this.id));
    }

    /**
     * Soft-deletes the admin account.
     * Sets the deletion timestamp, deactivates the account, bumps the session version for a
     * permanent cut-off, and emits a DELETED event.
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

        this.addDomainEvent(new DomainEvent(AdminEvent.DELETED, this.id));
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

    get role(): AdminRole {
        return this.props.role;
    }

    get isBanned(): boolean {
        return this.props.isBanned;
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
