/**
 * @file response-pagination.dto.ts
 * @description Response envelope every paginated list endpoint returns.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_DEFAULT_PAGE } from 'src/shared/pagination';

/**
 * Carries a page of items with the metadata a client needs to render paging controls,
 * so every list endpoint answers in the same shape.
 */
@Exclude()
@ApiSchema({ name: 'ResponsePagination', description: 'Standard envelope for paginated list responses.' })
export class ResponsePaginationDto<T> {
    /**
     * The list of items on the current page. The generic item schema here is a placeholder:
     * `ApiDefaultOkResponsePaginated` overrides it per endpoint with the concrete item type.
     */
    @Expose()
    @ApiProperty({
        type: 'array',
        items: { type: 'object' },
        description: 'The list of items on the current page.',
        example: [],
    })
    readonly items!: T[];

    /**
     * Total number of matching items in the database.
     */
    @Expose()
    @ApiProperty({
        type: 'integer',
        minimum: 0,
        description: 'Total number of matching items in the database.',
        example: 100,
    })
    readonly total!: number;

    /**
     * Current page number.
     */
    @Expose()
    @ApiProperty({
        type: 'integer',
        minimum: 1,
        description: 'Current page number.',
        example: PAGINATION_DEFAULT_PAGE,
    })
    readonly page!: number;

    /**
     * Number of items per page.
     */
    @Expose()
    @ApiProperty({
        type: 'integer',
        minimum: 1,
        description: 'Number of items per page.',
        example: PAGINATION_DEFAULT_LIMIT,
    })
    readonly limit!: number;

    /**
     * Total number of pages.
     */
    @Expose()
    @ApiProperty({
        type: 'integer',
        minimum: 0,
        description: 'Total number of pages.',
        example: 5,
    })
    readonly totalPages!: number;

    /**
     * Builds the envelope and derives `totalPages`, so callers cannot supply an inconsistent page count.
     *
     * @param items The items on the current page.
     * @param total The total number of matching items.
     * @param page The current page number.
     * @param limit The number of items per page.
     */
    constructor(items: T[], total: number, page: number, limit: number) {
        this.items = items;
        this.total = total;
        this.page = page;
        this.limit = limit;
        this.totalPages = Math.ceil(total / limit);
    }
}
