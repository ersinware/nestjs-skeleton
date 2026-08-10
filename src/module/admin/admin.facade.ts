/**
 * @file admin.facade.ts
 * @description The single entry point other modules use to read from the admin bounded context.
 */

import { Injectable } from '@nestjs/common';
import { QueryPipeline } from 'src/core/cqrs';
import {
    GetAdminAuthStateQuery,
    type GetAdminAuthStateResult,
} from 'src/module/admin/application/query/get-admin-auth-state/query';
import {
    GetAdminCredentialsByEmailQuery,
    type GetAdminCredentialsByEmailResult,
} from 'src/module/admin/application/query/get-admin-credentials-by-email/query';

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
     * @throws {ResourceNotFoundException} When no active admin exists with the given email.
     */
    async getCredentialsByEmail(email: string): Promise<GetAdminCredentialsByEmailResult> {
        return this.queryPipeline.execute(new GetAdminCredentialsByEmailQuery(email));
    }

    /**
     * Resolves an admin's authentication state (active status + session version) by their unique identifier.
     *
     * @param id The unique identifier of the target admin
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID.
     */
    async getAuthState(id: string): Promise<GetAdminAuthStateResult> {
        return this.queryPipeline.execute(new GetAdminAuthStateQuery(id));
    }
}
