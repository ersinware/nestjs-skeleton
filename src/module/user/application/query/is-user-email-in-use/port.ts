/**
 * @file port.ts
 * @description Primary-database availability check for an email change target.
 */

import type { IsUserEmailInUseResult } from 'src/module/user/application/query/is-user-email-in-use/query';

/**
 * Identifies the {@link IIsUserEmailInUsePort} email availability contract.
 */
export const TOKEN_IS_USER_EMAIL_IN_USE_PORT = Symbol();

/**
 * Checks persisted addresses without reserving pending targets.
 */
export interface IIsUserEmailInUsePort {
    /**
     * Includes deleted accounts because the email unique constraint also includes them.
     *
     * @param email Validated and normalized target address
     * @returns Result indicating whether an account already holds the address
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    isEmailInUse(email: string): Promise<IsUserEmailInUseResult>;
}
