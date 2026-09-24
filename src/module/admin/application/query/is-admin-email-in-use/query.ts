/**
 * @file query.ts
 * @description Result of checking whether an admin email address is already in use.
 */

/**
 * Whether an admin account holds the address, including deleted accounts.
 */
export type IsAdminEmailInUseResult = {
    /**
     * Whether the address is already held by an account.
     */
    readonly isInUse: boolean;
};
