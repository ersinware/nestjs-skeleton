/**
 * @file principal-aggregate-root.ts
 * @description Base class for Aggregate Roots that authenticate: owns the permission set, the two session counters, and the one administration rule every kind shares.
 */

import { SoftDeletableAggregateRoot } from 'src/shared/domain/aggregate-root/soft-deletable-aggregate-root';
import { PERMISSION_HOLDER, PrincipalType, type Permission, type Principal } from 'src/shared/domain/principal';
import { InvalidInputException, SystemException } from 'src/shared/exception';

/**
 * What a permission change did: the permissions that were added and the ones taken away, as the
 * audit record's evidence of the transition.
 */
export type PermissionChange = {
    readonly granted: readonly Permission[];
    readonly revoked: readonly Permission[];
};

/**
 * Base class for Aggregate Roots that are principals — accounts that log in, hold permissions and
 * carry the session counters. Owns them the way `SoftDeletableAggregateRoot` owns `deletedAt`, so
 * the permission mechanics have exactly one home. Opt-in: only an account that authenticates is a
 * principal.
 *
 * Administration knows one universal rule here: only an ADMIN ever administers, because every
 * administering permission is admin-held. Whatever a kind adds on top — a rank hierarchy among
 * its own accounts — is that kind's invariant and lives in its aggregate, by refining
 * {@link assertAdministrableBy}; this class names no concrete permission.
 */
export abstract class PrincipalAggregateRoot extends SoftDeletableAggregateRoot {
    /** The kind of principal the concrete aggregate is; decides which permissions it may hold. */
    protected abstract readonly principalType: PrincipalType;

    private _permissions: Permission[];

    private _sessionVersion: number;

    private _revocationVersion: number;

    /**
     * Initializes the principal base state.
     *
     * @param id The unique identifier
     * @param deletedAt The persisted deletion timestamp, or null while the aggregate is live
     * @param permissions The permissions the principal currently holds
     * @param sessionVersion The persisted session version
     * @param revocationVersion The persisted session version of the last full revocation
     */
    protected constructor(
        id: string,
        deletedAt: Date | null,
        permissions: readonly Permission[],
        sessionVersion: number,
        revocationVersion: number,
    ) {
        super(id, deletedAt);
        this._permissions = [...permissions];
        this._sessionVersion = sessionVersion;
        this._revocationVersion = revocationVersion;
    }

    /**
     * Retires every outstanding ACCESS token while leaving refresh tokens alive: the next refresh
     * re-reads the account and mints an access token from its current state. The cut-off for a
     * change the token's claims must reflect (permissions) but that revokes nothing.
     */
    protected retireAccessTokens() {
        this._sessionVersion++;
    }

    /**
     * Revokes every outstanding session, access and refresh tokens alike: the principal must sign
     * in again. Subclasses call it from the mutations that end a session's right to exist (ban,
     * deletion, password change, refresh-token reuse).
     */
    protected revokeAllSessions() {
        this._sessionVersion++;
        this._revocationVersion = this._sessionVersion;
    }

    /**
     * Gets the permissions the principal holds.
     */
    get permissions(): readonly Permission[] {
        return this._permissions;
    }

    /**
     * Gets the monotonic session version: the version new tokens are minted at, and the floor an
     * ACCESS token must reach to be accepted by the auth guard.
     */
    get sessionVersion(): number {
        return this._sessionVersion;
    }

    /**
     * Gets the session version of the last full revocation: the floor a REFRESH token must reach
     * to be rotated. Trails `sessionVersion` by exactly the bumps that retired access tokens only.
     */
    get revocationVersion(): number {
        return this._revocationVersion;
    }

    /**
     * Guards the one invariant that holds for EVERY administration of ANY principal: only an admin
     * administers. The first statement of every administering mutator, after `assertNotDeleted`, so
     * the answer never depends on what the action would have changed. A kind with rules among its
     * own accounts overrides this, calls `super`, and adds them.
     *
     * @param actor The verified principal performing the administration
     * @throws {SystemException} When a non-admin actor reaches the mutation — no permission admits
     * one past the guard, so only a bug can
     */
    protected assertAdministrableBy(actor: Principal) {
        if (actor.type !== PrincipalType.ADMIN) {
            throw new SystemException('Only an admin may administer a principal.', {
                context: {
                    class: this.constructor.name,
                    method: this.assertAdministrableBy.name,
                    id: this.id,
                    actorId: actor.id,
                    actorType: actor.type,
                },
            });
        }
    }

    /**
     * Replaces the permission set with `permissions`, enforcing only that every permission is one
     * this kind of principal may hold — who may make the change, and with which set, is decided by
     * the subclass before it calls this. A change retires the access tokens: they carry the
     * permissions, so the old set must die with them, while the refresh token survives to fetch the
     * new one. Subclasses wrap this to stamp their timestamp and emit their event.
     *
     * @param permissions The complete permission set the principal should hold afterwards
     * @returns The permissions granted and revoked, or null when the set already held and nothing changed
     * @throws {InvalidInputException} When the set holds a permission this kind of principal may not hold
     */
    protected applyPermissions(permissions: readonly Permission[]): PermissionChange | null {
        const target = [...new Set(permissions)],
            unholdable = target.find((permission) => PERMISSION_HOLDER[permission] !== this.principalType);

        if (unholdable) {
            throw new InvalidInputException(
                `The permission '${unholdable}' cannot be held by a principal of type '${this.principalType}'.`,
            );
        }

        const granted = target.filter((permission) => !this._permissions.includes(permission)),
            revoked = this._permissions.filter((permission) => !target.includes(permission));

        if (granted.length === 0 && revoked.length === 0) {
            return null;
        }

        this._permissions = target;
        this.retireAccessTokens();

        return { granted, revoked };
    }
}
