/**
 * @file identity-reader.adapter.ts
 * @description Implements the identity lookup by routing each realm to the facade of the bounded context that owns it.
 */

import { Injectable } from '@nestjs/common';
import { AdminFacade } from 'src/module/admin';
import {
    IdentityRealm,
    type AuthIdentity,
    type AuthState,
    type IIdentityReaderPort,
} from 'src/module/auth/application/command/port/identity-reader.port';
import { UserFacade } from 'src/module/user';
import { UserRole } from 'src/shared/domain/user';
import { SystemException } from 'src/shared/exception';

/**
 * The single role every user-realm identity holds — that realm's read model has no role column.
 * Closed over {@link UserRole} so a second member fails compilation here, forcing the role to come
 * from the read model instead of this stamp.
 */
const SOLE_USER_ROLE = { [UserRole.USER]: UserRole.USER } as const satisfies Record<UserRole, UserRole>;

/**
 * Adapter that gives the Auth module a single read surface over both identity realms.
 *
 * The realm-to-facade routing lives here rather than in the handlers: composing several sources
 * behind one narrowed contract is the adapter's job, and it keeps authentication unaware of which
 * bounded contexts exist.
 */
@Injectable()
export class IdentityReaderAdapter implements IIdentityReaderPort {
    /**
     * Injects both context facades to serve either realm.
     *
     * @param userFacade The user module facade
     * @param adminFacade The admin module facade
     */
    constructor(
        private readonly userFacade: UserFacade,
        private readonly adminFacade: AdminFacade,
    ) {}

    /**
     * Looks up an identity in the given realm strictly by its email address.
     *
     * @param realm The bounded context that owns the identity
     * @param email The email address to search for
     * @returns The associated identity
     * @throws {ResourceNotFoundException} If no identity is found
     */
    async getCredentialsByEmail(realm: IdentityRealm, email: string): Promise<AuthIdentity> {
        // Exhaustive on purpose: a realm added to the enum without a routing arm here must fail
        // compilation, never silently fall through to another context's facade.
        switch (realm) {
            case IdentityRealm.ADMIN:
                return this.adminFacade.getCredentialsByEmail(email);
            case IdentityRealm.USER:
                return { ...(await this.userFacade.getCredentialsByEmail(email)), role: SOLE_USER_ROLE[UserRole.USER] };
            default:
                return assertRealmExhausted(realm);
        }
    }

    /**
     * Retrieves an identity's ban status and current session version by its unique identifier.
     *
     * @param realm The bounded context that owns the identity
     * @param id The unique identifier of the target identity
     * @returns The ban status and current session version
     * @throws {ResourceNotFoundException} If no identity is found
     */
    async getAuthState(realm: IdentityRealm, id: string): Promise<AuthState> {
        switch (realm) {
            case IdentityRealm.ADMIN:
                return this.adminFacade.getAuthState(id);
            case IdentityRealm.USER:
                return this.userFacade.getAuthState(id);
            default:
                return assertRealmExhausted(realm);
        }
    }
}

/**
 * Compile-time exhaustiveness gate for realm routing: adding a member to {@link IdentityRealm}
 * without a routing arm makes the `default` branch pass a non-`never` value here and fail
 * compilation. The runtime throw is unreachable through typed callers — hence a SystemException,
 * because a broken code path must surface as 500 + Sentry.
 *
 * @param realm The realm no routing arm claimed
 * @throws {SystemException} Always — reaching it at runtime is a bug.
 */
function assertRealmExhausted(realm: never): never {
    throw new SystemException(`Unroutable identity realm: ${String(realm)}`, {
        context: { class: IdentityReaderAdapter.name, method: assertRealmExhausted.name },
    });
}
