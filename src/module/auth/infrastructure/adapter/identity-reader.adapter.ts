/**
 * @file identity-reader.adapter.ts
 * @description Implements the identity lookup by routing each kind of principal to the facade of the bounded context that owns it.
 */

import { Injectable } from '@nestjs/common';
import { AdminFacade } from 'src/module/admin';
import type {
    AuthIdentity,
    AuthState,
    IIdentityReaderPort,
} from 'src/module/auth/application/command/port/identity-reader.port';
import { UserFacade } from 'src/module/user';
import { PrincipalType } from 'src/shared/domain/principal';
import { SystemException } from 'src/shared/exception';

/**
 * Adapter that gives the Auth module a single read surface over both kinds of principal.
 *
 * The kind-to-facade routing lives here rather than in the handlers: composing several sources
 * behind one narrowed contract is the adapter's job, and it keeps authentication unaware of which
 * bounded contexts exist.
 */
@Injectable()
export class IdentityReaderAdapter implements IIdentityReaderPort {
    /**
     * Injects both context facades to serve either kind.
     *
     * @param userFacade The user module facade
     * @param adminFacade The admin module facade
     */
    constructor(
        private readonly userFacade: UserFacade,
        private readonly adminFacade: AdminFacade,
    ) {}

    /**
     * Looks up an identity of the given kind strictly by its email address.
     *
     * @param principalType The bounded context that owns the identity
     * @param email The email address to search for
     * @returns The associated identity
     * @throws {ResourceNotFoundException} If no identity is found
     */
    async getCredentialsByEmail(principalType: PrincipalType, email: string): Promise<AuthIdentity> {
        // Exhaustive on purpose: a kind added to the enum without a routing arm here must fail
        // compilation, never silently fall through to another context's facade.
        switch (principalType) {
            case PrincipalType.ADMIN:
                return this.adminFacade.getCredentialsByEmail(email);
            case PrincipalType.USER:
                return this.userFacade.getCredentialsByEmail(email);
            default:
                return assertPrincipalTypeExhausted(principalType);
        }
    }

    /**
     * Retrieves an identity's ban status, session counters and permissions by its unique identifier.
     *
     * @param principalType The bounded context that owns the identity
     * @param id The unique identifier of the target identity
     * @returns The ban status, session counters and permissions
     * @throws {ResourceNotFoundException} If no identity is found
     */
    async getAuthState(principalType: PrincipalType, id: string): Promise<AuthState> {
        switch (principalType) {
            case PrincipalType.ADMIN:
                return this.adminFacade.getAuthState(id);
            case PrincipalType.USER:
                return this.userFacade.getAuthState(id);
            default:
                return assertPrincipalTypeExhausted(principalType);
        }
    }
}

/**
 * Compile-time exhaustiveness gate for kind routing: adding a member to {@link PrincipalType}
 * without a routing arm makes the `default` branch pass a non-`never` value here and fail
 * compilation. The runtime throw is unreachable through typed callers — hence a SystemException,
 * because a broken code path must surface as 500 + Sentry.
 *
 * @param principalType The kind no routing arm claimed
 * @throws {SystemException} Always — reaching it at runtime is a bug.
 */
function assertPrincipalTypeExhausted(principalType: never): never {
    throw new SystemException(`Unroutable principal type: ${String(principalType)}`, {
        context: { class: IdentityReaderAdapter.name, method: assertPrincipalTypeExhausted.name },
    });
}
