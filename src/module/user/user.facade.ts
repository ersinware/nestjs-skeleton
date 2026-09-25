/**
 * @file user.facade.ts
 * @description The single entry point other modules use to read from the user bounded context.
 */

import { Injectable } from '@nestjs/common';
import { QueryPipeline } from 'src/core/cqrs';
import {
    GetUserCredentialsByEmailQuery,
    type GetUserCredentialsByEmailResult,
} from 'src/module/user/application/query/get-user-credentials-by-email/query';
import {
    GetUserRefreshStateQuery,
    type GetUserRefreshStateResult,
} from 'src/module/user/application/query/get-user-refresh-state/query';

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
     * Resolves current token claims for an account eligible to refresh the supplied token version.
     *
     * @param id The account identifier
     * @param tokenSessionVersion The verified refresh token's session version
     * @returns Current token claims for the eligible account
     * @throws {ResourceNotFoundException} When the account is missing, deleted, banned, or the token version is revoked
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    async getRefreshState(id: string, tokenSessionVersion: number): Promise<GetUserRefreshStateResult> {
        return this.queryPipeline.execute(new GetUserRefreshStateQuery(id, tokenSessionVersion));
    }
}
