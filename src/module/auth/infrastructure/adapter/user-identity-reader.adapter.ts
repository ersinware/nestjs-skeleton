/**
 * @file user-identity-reader.adapter.ts
 * @description Implements the identity provider for regular users, adapting the UserFacade to the Auth module's required interface.
 */

import { Injectable } from '@nestjs/common';
import type {
    AuthIdentity,
    IUserIdentityReaderPort,
} from 'src/module/auth/application/command/port/user-identity-reader.port';
import { UserFacade } from 'src/module/user';

/**
 * Adapter that provides the Auth module access to the User identity data.
 */
@Injectable()
export class UserIdentityReaderAdapter implements IUserIdentityReaderPort {
    /**
     * Injects the User facade to communicate with the User bounded context.
     *
     * @param userFacade The user module facade
     */
    constructor(private readonly userFacade: UserFacade) {}

    /**
     * Looks up a user strictly by their email address.
     *
     * @param email The email address to search for
     * @returns The associated user identity
     * @throws {ResourceNotFoundException} If no identity is found
     */
    async getCredentialsByEmail(email: string): Promise<AuthIdentity> {
        return this.userFacade.getCredentialsByEmail(email);
    }

    /**
     * Retrieves a user's ban status and current session version by their unique identifier.
     *
     * @param id The unique identifier of the target identity
     * @returns The ban status and current session version
     * @throws {ResourceNotFoundException} If no identity is found
     */
    async getAuthState(id: string): Promise<{ isBanned: boolean; version: number }> {
        return this.userFacade.getAuthState(id);
    }
}
