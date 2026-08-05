/**
 * @file index.ts
 * @description Public entry point of the pagination concern. Nothing outside may import past this barrel.
 */

export type { PaginationParams } from 'src/shared/pagination/pagination-params.type';
export {
    PAGINATION_DEFAULT_LIMIT,
    PAGINATION_DEFAULT_PAGE,
    PAGINATION_MAX_LIMIT,
    PAGINATION_MAX_OFFSET,
} from 'src/shared/pagination/pagination.constant';
