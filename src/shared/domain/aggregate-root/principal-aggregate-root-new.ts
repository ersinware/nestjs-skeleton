/**
 * @file principal-aggregate-root-new.ts
 * @description Defines shared permission and session state for job-producing principals.
 */

import type { PermissionChange } from 'src/shared/domain/aggregate-root/principal-aggregate-root';
import { SoftDeletableAggregateRootNew } from 'src/shared/domain/aggregate-root/soft-deletable-aggregate-root-new';
import { PERMISSION_HOLDER, PrincipalType, type Permission, type Principal } from 'src/shared/domain/principal';
import { InvalidInputException, SystemException } from 'src/shared/exception';

/**
 * Base for job-producing principals that own permissions and session counters.
 */
export abstract class PrincipalAggregateRootNew extends SoftDeletableAggregateRootNew {
    /**
     * Principal kind used to validate permission ownership.
     */
    protected abstract readonly principalType: PrincipalType;

    /**
     * Permissions currently held by the principal.
     */
    private permissionsValue: Permission[];

    /**
     * Monotonic floor for access tokens.
     */
    private sessionVersionValue: number;

    /**
     * Session-version floor for refresh tokens.
     */
    private revocationVersionValue: number;

    /**
     * Initializes the principal's permissions and session state.
     *
     * @param id The unique identifier
     * @param version The persisted version the state was loaded at; 0 for a new aggregate
     * @param deletedAt The persisted deletion timestamp, or null while the aggregate is live
     * @param permissions The permissions the principal currently holds
     * @param sessionVersion The persisted session version
     * @param revocationVersion The persisted version of the last full revocation
     */
    protected constructor(
        id: string,
        version: number,
        deletedAt: Date | null,
        permissions: readonly Permission[],
        sessionVersion: number,
        revocationVersion: number,
    ) {
        super(id, version, deletedAt);
        this.permissionsValue = [...permissions];
        this.sessionVersionValue = sessionVersion;
        this.revocationVersionValue = revocationVersion;
    }

    /**
     * Retires all outstanding access tokens while leaving refresh tokens alive.
     */
    protected retireAccessTokens() {
        this.sessionVersionValue++;
    }

    /**
     * Revokes all outstanding access and refresh tokens.
     */
    protected revokeAllSessions() {
        this.sessionVersionValue++;
        this.revocationVersionValue = this.sessionVersionValue;
    }

    /**
     * Rejects administrative mutations performed by non-admin principals.
     *
     * @param actor The verified principal performing the administration
     * @throws {SystemException} When a non-admin actor reaches the mutation
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
     * Replaces the permission set after validating that this principal kind may hold every entry.
     *
     * @param permissions The complete permission set the principal should hold afterwards
     * @returns The permissions granted and revoked, or null when nothing changed
     * @throws {InvalidInputException} When this principal kind may not hold a requested permission
     */
    protected applyPermissions(permissions: readonly Permission[]): PermissionChange | null {
        const target = [...new Set(permissions)],
            unholdable = target.find((permission) => PERMISSION_HOLDER[permission] !== this.principalType);

        if (unholdable) {
            throw new InvalidInputException(
                `The permission '${unholdable}' cannot be held by a principal of type '${this.principalType}'.`,
            );
        }

        const granted = target.filter((permission) => !this.permissionsValue.includes(permission)),
            revoked = this.permissionsValue.filter((permission) => !target.includes(permission));

        if (granted.length === 0 && revoked.length === 0) {
            return null;
        }

        this.permissionsValue = target;
        this.retireAccessTokens();

        return { granted, revoked };
    }

    /**
     * Returns the principal's permissions.
     *
     * @returns Current permissions
     */
    get permissions(): readonly Permission[] {
        return this.permissionsValue;
    }

    /**
     * Returns the access-token session floor.
     *
     * @returns Current session version
     */
    get sessionVersion(): number {
        return this.sessionVersionValue;
    }

    /**
     * Returns the refresh-token session floor.
     *
     * @returns Session version of the latest full revocation
     */
    get revocationVersion(): number {
        return this.revocationVersionValue;
    }
}
