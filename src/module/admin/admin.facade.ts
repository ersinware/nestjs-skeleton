/**
 * @file admin.facade.ts
 * @description The single entry point other modules use to read from the admin bounded context.
 */

import { Injectable } from '@nestjs/common';
import { QueryPipeline } from 'src/core/cqrs';
import {
    GetAdminCredentialsByEmailQuery,
    type GetAdminCredentialsByEmailResult,
} from 'src/module/admin/application/query/get-admin-credentials-by-email/query';
import {
    GetAdminRefreshStateQuery,
    type GetAdminRefreshStateResult,
} from 'src/module/admin/application/query/get-admin-refresh-state/query';

/**
 * Read-only facade of the admin bounded context. Other modules inject this instead of anything
 * internal; results are the queries' flat read-models, never domain or infrastructure objects.
 */
@Injectable()
export class AdminFacade {
    /**
     * Injects the pipeline the facade dispatches its queries through.
     *
     * @param queryPipeline The CQRS query pipeline
     */
    constructor(private readonly queryPipeline: QueryPipeline) {}

    /**
     * Resolves the authentication identity for an admin by their email address.
     *
     * @param email The email address of the target admin
     * @returns The admin credential read model
     * @throws {ResourceNotFoundException} When no active admin exists with the given email.
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    async getCredentialsByEmail(email: string): Promise<GetAdminCredentialsByEmailResult> {
        return this.queryPipeline.execute(new GetAdminCredentialsByEmailQuery(email));
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
    async getRefreshState(id: string, tokenSessionVersion: number): Promise<GetAdminRefreshStateResult> {
        return this.queryPipeline.execute(new GetAdminRefreshStateQuery(id, tokenSessionVersion));
    }
}
