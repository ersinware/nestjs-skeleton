/**
 * @file port.ts
 * @description Primary-database availability check for an email change target.
 */

/**
 * Identifies the email availability contract.
 */
export const TOKEN_IS_ADMIN_EMAIL_IN_USE_PORT = Symbol();

/**
 * Checks persisted addresses without reserving pending targets.
 */
export interface IIsAdminEmailInUsePort {
    /**
     * Includes deleted accounts because the email unique constraint also includes them.
     *
     * @param email Validated and normalized target address
     * @returns Whether an account already holds the address
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    isEmailInUse(email: string): Promise<boolean>;
}
