/**
 * @file principal.type.ts
 * @description The verified identity acting in a request: who they are, which context owns them, and what they may do.
 */

import type { Permission } from 'src/shared/domain/principal/permission.enum';
import type { PrincipalType } from 'src/shared/domain/principal/principal-type.enum';

/**
 * A verified principal as the domain sees it. Built from a verified access token at the edge and
 * handed to commands that must weigh the actor against the target (self-administration, the
 * tier hierarchy), so a business rule never reads HTTP or a token payload itself.
 */
export type Principal = {
    /**
     * The principal identifier.
     */
    readonly id: string;

    /**
     * The bounded context that owns the account.
     */
    readonly type: PrincipalType;

    /**
     * The permissions the principal held when its access token was minted.
     */
    readonly permissions: readonly Permission[];
};
