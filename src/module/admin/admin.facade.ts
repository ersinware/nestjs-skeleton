/**
 * @file admin.facade.ts
 * @description The single public API for the Admins module. Exposes querying capabilities to other modules.
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
 * The single public API for the Admins module.
 * Other modules MUST inject this Facade instead of internal services.
 * Returns flat interface types — never internal domain or infrastructure objects.
 */
@Injectable()
export class AdminFacade {
    /**
     * Initializes the admin facade with the query pipeline.
     *
     * @param queryPipeline The CQRS query pipeline (caching behavior applies to cacheable queries)
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
