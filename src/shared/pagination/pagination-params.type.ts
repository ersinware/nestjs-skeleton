/**
 * @file pagination-params.interface.ts
 * @description Pure TypeScript type for pagination parameters, decoupled from framework/validation libraries.
 */

export type PaginationParams = {
    /**
     * The current page number.
     */
    page: number;

    /**
     * The number of items per page.
     */
    limit: number;
};
