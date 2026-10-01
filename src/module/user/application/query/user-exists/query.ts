/**
 * @file query.ts
 * @description Result of checking whether a user identity is already persisted.
 */

/**
 * Whether a user identity exists, including deleted accounts.
 */
export type UserExistsResult = {
    /**
     * Whether the account identity is already held by a persisted row.
     */
    readonly exists: boolean;
};
