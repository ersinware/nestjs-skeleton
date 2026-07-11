/**
 * @file admin.facade.ts
 * @description The single public API for the Admins module. Exposes querying capabilities to other modules.
 */

import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import {
    CheckAdminIsActiveQuery,
    type CheckAdminIsActiveResult,
} from 'src/module/admin/application/query/check-admin-is-active';
import {
    GetAdminCredentialsByEmailQuery,
    type GetAdminCredentialsByEmailResult,
} from 'src/module/admin/application/query/get-admin-credentials-by-email';

/**
 * The single public API for the Admins module.
 * Other modules MUST inject this Facade instead of internal services.
 * Returns flat interface types — never internal domain or infrastructure objects.
 */
@Injectable()
export class AdminFacade {
    /**
     * Initializes the admin facade with the query bus.
     *
     * @param queryBus The CQRS query bus
     */
    constructor(private readonly queryBus: QueryBus) {}

    /**
     * Resolves the authentication identity for an admin by their email address.
     *
     * @param email The email address of the target admin
     * @throws {ResourceNotFoundException} When no active admin exists with the given email.
     */
    async getCredentialsByEmail(email: string): Promise<GetAdminCredentialsByEmailResult> {
        return this.queryBus.execute<GetAdminCredentialsByEmailQuery, GetAdminCredentialsByEmailResult>(
            new GetAdminCredentialsByEmailQuery(email),
        );
    }

    /**
     * Checks if an admin is active by their unique identifier.
     *
     * @param id The unique identifier of the target admin
     * @throws {ResourceNotFoundException} When no active admin exists with the given ID.
     */
    async checkIsActive(id: string): Promise<boolean> {
        return this.queryBus.execute<CheckAdminIsActiveQuery, CheckAdminIsActiveResult>(
            new CheckAdminIsActiveQuery(id),
        );
    }
}
