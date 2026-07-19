/**
 * @file response-pagination.dto.ts
 * @description Standardized data transfer object for paginated responses.
 */

import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_DEFAULT_PAGE } from 'src/shared/pagination';

/**
 * Standardized response envelope structure for paginated lists.
 */
@Exclude()
export class ResponsePaginationDto<T> {
    /**
     * The list of items on the current page.
     * Note: This property is dynamically overridden in ApiDefaultOkResponsePaginated
     * to support proper Swagger/Scalar schema and example generation.
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
     * Creates an instance of ResponsePaginationDto.
     *
     * @param items List of items.
     * @param total Total items count.
     * @param page Current page.
     * @param limit Items per page.
     */
    constructor(items: T[], total: number, page: number, limit: number) {
        this.items = items;
        this.total = total;
        this.page = page;
        this.limit = limit;
        this.totalPages = Math.ceil(total / limit);
    }
}
