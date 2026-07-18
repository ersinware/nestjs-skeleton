/**
 * @file admin-identity-reader.adapter.ts
 * @description Implements the identity provider for Admin users, adapting the AdminFacade to the Auth module's required interface.
 */

import { Injectable } from '@nestjs/common';
import { AdminFacade } from 'src/module/admin';
import type {
    AuthAdminIdentity,
    IAdminIdentityReaderPort,
} from 'src/module/auth/application/command/port/admin-identity-reader.port';

/**
 * Adapter that provides the Auth module access to the Admin identity data.
 */
@Injectable()
export class AdminIdentityReaderAdapter implements IAdminIdentityReaderPort {
    /**
     * Injects the Admin facade to communicate with the Admin bounded context.
     *
     * @param adminFacade The admin module facade
     */
    constructor(private readonly adminFacade: AdminFacade) {}

    /**
     * Looks up an admin strictly by their email address.
     *
     * @param email The email address to search for
     * @returns The associated admin identity
     * @throws {ResourceNotFoundException} If no identity is found
     */
    async getCredentialsByEmail(email: string): Promise<AuthAdminIdentity> {
        return this.adminFacade.getCredentialsByEmail(email);
    }

    /**
     * Retrieves an admin's ban status and current session version by their unique identifier.
     *
     * @param id The unique identifier of the target identity
     * @returns The ban status and current session version
     * @throws {ResourceNotFoundException} If no identity is found
     */
    async getAuthState(id: string): Promise<{ isBanned: boolean; version: number }> {
        return this.adminFacade.getAuthState(id);
    }
}
