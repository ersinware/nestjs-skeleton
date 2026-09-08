/**
 * @file query.ts
 * @description Query that resolves an admin's credential read-model by email. Carries the password
 * hash, so it is consumed only by the auth flow — never exposed through a controller.
 */

import { Query } from '@nestjs/cqrs';
import type { Permission } from 'src/shared/domain/principal';

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
 * The credential fields login verifies (password hash) and embeds into the minted tokens (id,
 * permissions, session version), plus the ban status it checks. The password is null while the account is pending activation;
 * whether such an account may authenticate is the login flow's decision.
 */
export type GetAdminCredentialsByEmailResult = {
    readonly id: string;
    readonly password: string | null;
    readonly permissions: readonly Permission[];
    readonly isBanned: boolean;
    readonly sessionVersion: number;
};
