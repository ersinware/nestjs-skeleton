/**
 * @file pagination.constant.ts
 * @description Constants for offset-based pagination defaults.
 */

/**
 * The default page number used when no page query parameter is provided by the client.
 */
export const PAGINATION_DEFAULT_PAGE = 1;

/**
 * The default item limit per page used when no limit query parameter is provided by the client.
 */
export const PAGINATION_DEFAULT_LIMIT = 20;

/**
 * The highest item limit a client may request per page.
 * The other half of the paging policy alongside {@link PAGINATION_MAX_OFFSET}: together they bound
 * the cost of a single paginated read.
 */
export const PAGINATION_MAX_LIMIT = 100;

/**
 * The highest offset a client may reach through the page/limit combination.
 * An offset-based read makes the database walk and discard every skipped row, so an unbounded
 * page number turns a single request into a full scan; this ceiling keeps that cost constant.
 */
export const PAGINATION_MAX_OFFSET = 10_000;
