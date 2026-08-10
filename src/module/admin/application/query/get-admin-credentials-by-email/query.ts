/**
 * @file query.ts
 * @description Query that resolves an admin's credential read-model by email. Carries the password
 * hash, so it is consumed only by the auth flow — never exposed through a controller.
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
 * The credential fields login verifies (password hash) and embeds into the minted tokens (id, role,
 * ban status, session version).
 */
export type GetAdminCredentialsByEmailResult = {
    id: string;
    password: string;
    role: AdminRole;
    isBanned: boolean;
    version: number;
};
