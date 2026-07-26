/**
 * @file identity-reader.adapter.ts
 * @description Implements the identity lookup by routing each realm to the facade of the bounded context that owns it.
 */

import { Injectable } from '@nestjs/common';
import { AdminFacade } from 'src/module/admin';
import {
    IdentityRealm,
    type AuthIdentity,
    type IIdentityReaderPort,
} from 'src/module/auth/application/command/port/identity-reader.port';
import { UserFacade } from 'src/module/user';
import { UserRole } from 'src/shared/domain/user';

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
        if (realm === IdentityRealm.ADMIN) {
            return this.adminFacade.getCredentialsByEmail(email);
        }

        // The user context has no role column — every one of its identities holds the single USER
        // role, so the realm supplies what the read model cannot.
        return { ...(await this.userFacade.getCredentialsByEmail(email)), role: UserRole.USER };
    }

    /**
     * Retrieves an identity's ban status and current session version by its unique identifier.
     *
     * @param realm The bounded context that owns the identity
     * @param id The unique identifier of the target identity
     * @returns The ban status and current session version
     * @throws {ResourceNotFoundException} If no identity is found
     */
    async getAuthState(realm: IdentityRealm, id: string): Promise<{ isBanned: boolean; version: number }> {
        return realm === IdentityRealm.ADMIN ? this.adminFacade.getAuthState(id) : this.userFacade.getAuthState(id);
    }
}
