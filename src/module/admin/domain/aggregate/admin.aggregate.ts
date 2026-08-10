/**
 * @file admin.aggregate.ts
 * @description The Admin aggregate root — owns the state and invariants of an admin account.
 */

import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import { AdminRole } from 'src/shared/domain/admin';
import { SoftDeletableAggregateRoot } from 'src/shared/domain/aggregate-root';
import { DomainEvent } from 'src/shared/domain/event';

/**
 * The module-owned state of an Admin aggregate.
 */
type AdminProps = {
    email: string;
    name: string;
    password: string;
    role: AdminRole;
    isBanned: boolean;
    sessionVersion: number;
    createdAt: Date;
    updatedAt: Date;
};

/**
 * The full persistable state of an Admin: the module-owned props plus the identity and deletion
 * timestamp owned by the aggregate-root bases. Consumed by reconstitution, produced by
 * {@link Admin.toSnapshot}.
 */
type AdminSnapshot = { id: string; deletedAt: Date | null } & AdminProps;

/**
 * The Admin aggregate root. Owns every admin invariant: ban/unban transitions, session revocation
 * through the monotonic version counter, and soft-delete immutability.
 */
export class Admin extends SoftDeletableAggregateRoot {
    private props: AdminProps;

    /**
     * Splits the snapshot along the ownership boundary: id and deletedAt go to the aggregate-root
     * bases that own them, the rest becomes the module-owned state.
     *
     * @param snapshot The full aggregate state
     */
    private constructor({ id, deletedAt, ...props }: AdminSnapshot) {
        super(id, deletedAt);
        this.props = props;
    }

    /**
     * Creates a new Admin with a fresh lifecycle state. Emits no event: the sole creation path is
     * the seed script, which has no reaction to trigger.
     *
     * @param props The new identifier plus the initial properties, excluding lifecycle-managed fields
     * @returns The newly created aggregate
     */
    static create(
        props: { id: string } & Omit<AdminProps, 'isBanned' | 'sessionVersion' | 'createdAt' | 'updatedAt'>,
    ): Admin {
        const now = new Date();

        return new Admin({
            ...props,
            isBanned: false,
            deletedAt: null,
            sessionVersion: 0,
            createdAt: now,
            updatedAt: now,
        });
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
            deletedAt: this.deletedAt,
            ...this.props,
        };
    }

    /**
     * Bans the admin. Bumps the session version to instantly evict existing tokens, and emits a
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
        this.props.sessionVersion++;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(AdminEvent.BANNED, this.id));

        return true;
    }

    /**
     * Unbans the admin and emits an UNBANNED event. Does not bump the session version — the version is
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

        this.addDomainEvent(new DomainEvent(AdminEvent.UNBANNED, this.id));

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

        this.props.sessionVersion++;
        this.props.updatedAt = new Date();

        this.addDomainEvent(new DomainEvent(AdminEvent.SESSIONS_REVOKED, this.id));
    }

    /**
     * Soft-deletes the admin account: sets the deletion timestamp, bans the account, bumps the
     * session version for a permanent cut-off, and emits a DELETED event. A no-op when already
     * deleted.
     */
    markAsDeleted() {
        if (this.deletedAt) {
            return;
        }

        const now = new Date();

        this.setDeletedAt(now);
        this.props.isBanned = true;
        this.props.sessionVersion++;
        this.props.updatedAt = now;

        this.addDomainEvent(new DomainEvent(AdminEvent.DELETED, this.id));
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

    /** The administrative role. */
    get role(): AdminRole {
        return this.props.role;
    }

    /** Whether the account is banned. */
    get isBanned(): boolean {
        return this.props.isBanned;
    }

    /** The monotonic session-version counter. */
    get sessionVersion(): number {
        return this.props.sessionVersion;
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
