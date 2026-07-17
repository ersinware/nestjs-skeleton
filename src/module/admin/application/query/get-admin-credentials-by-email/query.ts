/**
 * @file get-admin-credentials-by-email.query.ts
 * @description Query that resolves the minimal credential projection for an admin by email.
 * Used exclusively by the internal modules.
 */

import { Query } from '@nestjs/cqrs';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * Fetches authentication credentials for an admin by their email address.
 */
export class GetAdminCredentialsByEmailQuery extends Query<GetAdminCredentialsByEmailResult> {
    /**
     * Initializes the query with its parameters.
     *
     * @param email The email address to query
     */
    constructor(readonly email: string) {
        super();
    }
}

/**
 * The expected result of the GetAdminCredentialsByEmailQuery, returning the credentials read model.
 */
export type GetAdminCredentialsByEmailResult = {
    id: string;
    password: string;
    role: AdminRole;
    isBanned: boolean;
    version: number;
};
