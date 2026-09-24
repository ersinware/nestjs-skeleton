/**
 * @file query.ts
 * @description Result of checking whether a user email address is already in use.
 */

/**
 * Whether a user account holds the address, including deleted accounts.
 */
export type IsUserEmailInUseResult = {
    /**
     * Whether the address is already held by an account.
     */
    readonly isInUse: boolean;
};
