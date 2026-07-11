/**
 * @file get-admin-credentials-by-id.query.ts
 * @description Query that resolves the minimal credential projection for an admin by ID.
 * Used exclusively by the internal modules.
 */

import { Query } from '@nestjs/cqrs';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * Fetches authentication credentials for an admin by their unique identifier.
 */
export class GetAdminCredentialsByIdQuery extends Query<GetAdminCredentialsByIdResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param id The unique identifier of the admin
     */
    constructor(readonly id: string) {
        super();
    }
}

/**
 * The expected result of the GetAdminCredentialsByIdQuery, returning the credentials read model.
 */
export type GetAdminCredentialsByIdResult = {
    id: string;
    password: string;
    role: AdminRole;
    isActive: boolean;
};
