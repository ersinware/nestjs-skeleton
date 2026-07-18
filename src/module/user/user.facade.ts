/**
 * @file user.facade.ts
 * @description The single public API for the Users module. Exposes user querying capabilities to other modules.
 */

import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import {
    GetUserAuthStateQuery,
    type GetUserAuthStateResult,
} from 'src/module/user/application/query/get-user-auth-state/query';
import {
    GetUserCredentialsByEmailQuery,
    type GetUserCredentialsByEmailResult,
} from 'src/module/user/application/query/get-user-credentials-by-email/query';

/**
 * The single public API for the Users module.
 * Other modules MUST inject this Facade instead of internal services.
 * Returns flat interface types — never internal domain or infrastructure objects.
 */
@Injectable()
export class UserFacade {
    /**
     * Initializes the user facade with the CQRS query bus.
     *
     * @param queryBus The CQRS query bus instance
     */
    constructor(private readonly queryBus: QueryBus) {}

    /**
     * Resolves the authentication identity for a user by their email address.
     *
     * @param email The email address of the target user
     * @returns The user credential read model
     * @throws {ResourceNotFoundException} When no active user exists with the given email
     */
    async getCredentialsByEmail(email: string): Promise<GetUserCredentialsByEmailResult> {
        return this.queryBus.execute<GetUserCredentialsByEmailQuery, GetUserCredentialsByEmailResult>(
            new GetUserCredentialsByEmailQuery(email),
        );
    }

    /**
     * Resolves a user's authentication state (active status + session version) by their unique identifier.
     *
     * @param id The unique identifier of the target user
     * @returns The user's active status and current session version
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     */
    async getAuthState(id: string): Promise<GetUserAuthStateResult> {
        return this.queryBus.execute<GetUserAuthStateQuery, GetUserAuthStateResult>(new GetUserAuthStateQuery(id));
    }
}
