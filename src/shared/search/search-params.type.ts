/**
 * @file search-params.type.ts
 * @description Pure TypeScript type for free-text search parameters.
 */

/**
 * Free-text search parameters carried by list queries that support filtering, decoupled from
 * framework and validation libraries so query contracts never learn HTTP.
 */
export type SearchParams = {
    /**
     * The free-text term to filter by; absent when the caller lists without filtering.
     */
    readonly search?: string;
};
