/**
 * @file user.facade.ts
 * @description The single public API for the Users module. Exposes user querying capabilities to other modules.
 */

import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import {
    CheckUserIsActiveQuery,
    type CheckUserIsActiveResult,
} from 'src/module/user/application/query/check-user-is-active';
import {
    GetUserCredentialsByEmailQuery,
    type GetUserCredentialsByEmailResult,
} from 'src/module/user/application/query/get-user-credentials-by-email';

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
     * Checks if a user is active by their unique identifier.
     *
     * @param id The unique identifier of the target user
     * @returns True if the user is active, false otherwise
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     */
    async checkIsActive(id: string): Promise<CheckUserIsActiveResult> {
        return this.queryBus.execute<CheckUserIsActiveQuery, CheckUserIsActiveResult>(new CheckUserIsActiveQuery(id));
    }
}
