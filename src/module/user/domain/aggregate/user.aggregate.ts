/**
 * @file user.aggregate.ts
 * @description Defines the state and invariants of a user account.
 */

import { randomUUID } from 'node:crypto';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';
import { PrincipalAggregateRoot, type PermissionChange } from 'src/shared/domain/aggregate-root';
import { PrincipalType, SessionRevocationReason, type Permission, type Principal } from 'src/shared/domain/principal';
import { SystemException } from 'src/shared/exception';

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
 * The full persistable state of a User: the module-owned props plus the identity, persistence
 * version, deletion timestamp, permissions and session counters owned by the aggregate-root bases. Consumed by
 * reconstitution, produced by {@link User.toSnapshot}.
 */
type UserSnapshot = {
    readonly id: string;
    readonly version: number;
    readonly deletedAt: Date | null;
    readonly permissions: readonly Permission[];
    readonly sessionVersion: number;
    readonly revocationVersion: number;
} & Readonly<UserProps>;

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
    }: UserSnapshot) {
        super(id, version, deletedAt, permissions, sessionVersion, revocationVersion);
        this.props = props;
    }

    /**
     * Creates a new User with a fresh lifecycle state and no permissions.
     *
     * @param props The new identifier plus the initial properties, excluding lifecycle-managed fields
     * @returns The newly created aggregate
     */
    static create(
        props: { readonly id: string } & Readonly<Omit<UserProps, 'isBanned' | 'createdAt' | 'updatedAt'>>,
    ): User {
        const now = new Date();

        return new User({
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
            version: this.version,
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
            this.addCacheInvalidationJob();
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

        this.addSessionReconciliationJob();
    }

    /**
     * Replaces the user's permission set and queues cache and session reconciliation when it changes.
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
            this.addCacheInvalidationJob();
            this.addSessionReconciliationJob();
        }

        return change;
    }

    /**
     * Bans the user and queues cache and session reconciliation. A no-op when already banned.
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

        this.addCacheInvalidationJob();
        this.addSessionReconciliationJob();

        return true;
    }

    /**
     * Unbans the user and queues cache invalidation without lowering the session version.
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

        this.addCacheInvalidationJob();

        return true;
    }

    /**
     * Revokes every active session and raises reason-specific follow-up jobs without banning the user.
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
                        eventId: randomUUID(),
                        aggregateId: this.id,
                        queueName: UserJobQueue.REFRESH_REUSE_NOTICE,
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

        this.addCacheInvalidationJob();
        this.addSessionReconciliationJob();
    }

    /**
     * Raises durable cache invalidation for the current user projection.
     */
    private addCacheInvalidationJob() {
        this.addJob([
            {
                eventId: randomUUID(),
                aggregateId: this.id,
                queueName: UserJobQueue.CACHE_INVALIDATE,
            },
        ]);
    }

    /**
     * Raises durable session-version reconciliation for the current user.
     */
    private addSessionReconciliationJob() {
        this.addJob([
            {
                eventId: randomUUID(),
                aggregateId: this.id,
                queueName: UserJobQueue.SESSION_RECONCILE,
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
     * Returns the password hash.
     *
     * @returns Current password hash
     */
    get password(): string {
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
        context: { class: User.name, method },
    });
}
