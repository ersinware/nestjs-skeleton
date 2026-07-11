/**
 * @file port.ts
 * @description Outbound port for CheckUserIsActiveQuery.
 */

import type { CheckUserIsActiveResult } from 'src/module/user/application/query/check-user-is-active/query';

export const TOKEN_CHECK_USER_IS_ACTIVE_PORT = Symbol('TOKEN_CHECK_USER_IS_ACTIVE_PORT');

export interface ICheckUserIsActivePort {
    /**
     * Checks if a user is active by their unique identifier.
     *
     * @param id The unique identifier of the target user
     * @returns The active status, or null if no user is found
     */
    checkIsActive(id: string): Promise<CheckUserIsActiveResult | null>;
}
