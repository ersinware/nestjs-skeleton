/**
 * @file principal-type.enum.ts
 * @description The kinds of authenticatable principal the system knows.
 */

/**
 * Which bounded context owns a principal's account. A token carries it so `sub` can be resolved to
 * the right table, and an audit record carries it so an actor id can be looked up without probing
 * every context. Authority is NOT expressed here — that is the principal's permission set.
 */
export enum PrincipalType {
    /**
     * An administrator account, owned by the admin bounded context.
     */
    ADMIN = 'admin',

    /**
     * An end-user account, owned by the user bounded context.
     */
    USER = 'user',
}
