/**
 * @file user-identity-reader.adapter.ts
 * @description Implements the identity provider for regular users, adapting the UserFacade to the Auth module's required interface.
 */

import { Injectable } from '@nestjs/common';
import type { AuthIdentity, IUserIdentityReaderPort } from 'src/module/auth/application/command/port';
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
     * Retrieves a specific user identity by their unique identifier to check if they are active.
     *
     * @param id The unique identifier of the target identity
     * @returns True if the user is active, false otherwise
     * @throws {ResourceNotFoundException} If no identity is found
     */
    async checkIsActive(id: string): Promise<boolean> {
        return this.userFacade.checkIsActive(id);
    }
}
