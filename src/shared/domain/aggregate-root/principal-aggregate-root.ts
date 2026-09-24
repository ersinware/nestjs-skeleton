/**
 * @file principal-aggregate-root.ts
 * @description Defines shared credential rules, permission state, and session state for job-producing principals.
 */

import { SoftDeletableAggregateRoot } from 'src/shared/domain/aggregate-root/soft-deletable-aggregate-root';
import { DomainFailureAuditAction } from 'src/shared/domain/audit';
import { PERMISSION_HOLDER, PrincipalType, type Permission, type Principal } from 'src/shared/domain/principal';
import { InvalidInputException, SystemException } from 'src/shared/exception';

/**
 * Permissions granted and revoked by a permission-set replacement.
 */
export type PermissionChange = {
    /**
     * Permissions added to the principal's set.
     */
    readonly granted: readonly Permission[];

    /**
     * Permissions removed from the principal's set.
     */
    readonly revoked: readonly Permission[];
};

/**
 * Password refusal reasons included when the calling flow records failed attempts.
 */
enum PasswordRejectionReason {
    /**
     * The submitted current password does not match the stored hash.
     */
    CURRENT_PASSWORD_MISMATCH = 'CURRENT_PASSWORD_MISMATCH',
}

/**
 * Base for job-producing principals that own credential rules, permissions, and session counters.
 */
export abstract class PrincipalAggregateRoot extends SoftDeletableAggregateRoot {
    /**
     * Principal kind used to validate permission ownership.
     */
    protected abstract readonly principalType: PrincipalType;

    /**
     * Permissions currently held by the principal.
     */
    private _permissions: Permission[];

    /**
     * Monotonic floor for access tokens.
     */
    private _sessionVersion: number;

    /**
     * Session-version floor for refresh tokens.
     */
    private _revocationVersion: number;

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
        this._permissions = [...permissions];
        this._sessionVersion = sessionVersion;
        this._revocationVersion = revocationVersion;
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

        const granted = target.filter((permission) => !this._permissions.includes(permission)),
            revoked = this._permissions.filter((permission) => !target.includes(permission));

        if (granted.length === 0 && revoked.length === 0) {
            return null;
        }

        this._permissions = target;
        this.retireAccessTokens();

        return { granted, revoked };
    }

    /**
     * Retires all outstanding access tokens while leaving refresh tokens alive.
     */
    protected retireAccessTokens() {
        this._sessionVersion++;
    }

    /**
     * Revokes all outstanding access and refresh tokens.
     */
    protected revokeAllSessions() {
        this._sessionVersion++;
        this._revocationVersion = this._sessionVersion;
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
     * Requires a matching current-password proof before sensitive work proceeds.
     *
     * @param currentPasswordMatches Hash verification result for this aggregate's current password
     * @param auditAction Business action to record on password mismatch
     * @throws {InvalidInputException} When the submitted password does not match; includes the audit reason when enabled
     */
    protected assertCurrentPassword(currentPasswordMatches: boolean, auditAction?: DomainFailureAuditAction) {
        if (!currentPasswordMatches) {
            throw new InvalidInputException(
                'The current password provided is incorrect.',
                auditAction
                    ? { audit: { action: auditAction, reason: PasswordRejectionReason.CURRENT_PASSWORD_MISMATCH } }
                    : undefined,
            );
        }
    }

    /**
     * Rejects an invalid current password or reuse before password mutation.
     *
     * @param currentPasswordMatches Whether the submitted current password matches the stored hash
     * @param newPasswordMatchesCurrent Whether the proposed new password matches that same stored hash
     * @param auditAction Business action to record when the current password is wrong
     * @throws {InvalidInputException} When the current password is wrong or the new password is unchanged
     */
    protected assertPasswordChange(
        currentPasswordMatches: boolean,
        newPasswordMatchesCurrent: boolean,
        auditAction?: DomainFailureAuditAction,
    ) {
        this.assertCurrentPassword(currentPasswordMatches, auditAction);

        if (newPasswordMatchesCurrent) {
            throw new InvalidInputException('New password cannot be the same as the current password.');
        }
    }

    /**
     * Returns the principal's permissions.
     *
     * @returns Current permissions
     */
    get permissions(): readonly Permission[] {
        return this._permissions;
    }

    /**
     * Returns the access-token session floor.
     *
     * @returns Current session version
     */
    get sessionVersion(): number {
        return this._sessionVersion;
    }

    /**
     * Returns the refresh-token session floor.
     *
     * @returns Session version of the latest full revocation
     */
    get revocationVersion(): number {
        return this._revocationVersion;
    }
}
