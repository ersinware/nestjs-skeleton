/**
 * @file pagination-params.type.ts
 * @description Pure TypeScript type for offset-based pagination parameters.
 */

/**
 * Pagination parameters carried by list queries, decoupled from framework and validation libraries
 * so query contracts never learn HTTP.
 */
export type PaginationParams = {
    /**
     * The current page number.
     */
    readonly page: number;

    /**
     * The number of items per page.
     */
    readonly limit: number;
};
