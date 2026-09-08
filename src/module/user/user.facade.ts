/**
 * @file user.facade.ts
 * @description The single entry point other modules use to read from the user bounded context.
 */

import { Injectable } from '@nestjs/common';
import { QueryPipeline } from 'src/core/cqrs';
import {
    GetUserAuthStateQuery,
    type GetUserAuthStateResult,
} from 'src/module/user/application/query/get-user-auth-state/query';
import {
    GetUserCredentialsByEmailQuery,
    type GetUserCredentialsByEmailResult,
} from 'src/module/user/application/query/get-user-credentials-by-email/query';

/**
 * Read-only facade of the user bounded context. Other modules inject this instead of anything
 * internal; results are the queries' flat read-models, never domain or infrastructure objects.
 */
@Injectable()
export class UserFacade {
    /**
     * Injects the pipeline the facade dispatches its queries through.
     *
     * @param queryPipeline The CQRS query pipeline
     */
    constructor(private readonly queryPipeline: QueryPipeline) {}

    /**
     * Resolves the authentication identity for a user by their email address.
     *
     * @param email The email address of the target user
     * @returns The user credential read model
     * @throws {ResourceNotFoundException} When no active user exists with the given email
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    async getCredentialsByEmail(email: string): Promise<GetUserCredentialsByEmailResult> {
        return this.queryPipeline.execute(new GetUserCredentialsByEmailQuery(email));
    }

    /**
     * Resolves a user's authentication state (ban status, session counters, permissions) by their unique identifier.
     *
     * @param id The unique identifier of the target user
     * @returns The user's ban status, session counters and permissions
     * @throws {ResourceNotFoundException} When no active user exists with the given ID
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    async getAuthState(id: string): Promise<GetUserAuthStateResult> {
        return this.queryPipeline.execute(new GetUserAuthStateQuery(id));
    }
}
