/**
 * @file response-pagination.dto.ts
 * @description Standardized data transfer object for paginated responses.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsArray, IsInt, Min } from 'class-validator';

/**
 * Standardized response envelope structure for paginated lists.
 */
@ApiSchema({ name: 'ResponsePagination', description: 'Standardized paginated response metadata' })
@Exclude()
export class ResponsePaginationDto<T> {
    /**
     * The list of items on the current page.
     * Note: This property is dynamically overridden in ApiDefaultOkResponsePaginated
     * to support proper Swagger/Scalar schema and example generation.
     */
    @Expose()
    @IsArray({ message: 'Items must be an array.' })
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
    @IsInt({ message: 'Total must be an integer.' })
    @Min(0, { message: 'Total cannot be less than 0.' })
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
    @IsInt({ message: 'Page must be an integer.' })
    @Min(1, { message: 'Page cannot be less than 1.' })
    @ApiProperty({
        type: 'integer',
        minimum: 1,
        description: 'Current page number.',
        example: 1,
    })
    readonly page!: number;

    /**
     * Number of items per page.
     */
    @Expose()
    @IsInt({ message: 'Limit must be an integer.' })
    @Min(1, { message: 'Limit cannot be less than 1.' })
    @ApiProperty({
        type: 'integer',
        minimum: 1,
        description: 'Number of items per page.',
        example: 20,
    })
    readonly limit!: number;

    /**
     * Total number of pages.
     */
    @Expose()
    @IsInt({ message: 'Total pages must be an integer.' })
    @Min(0, { message: 'Total pages cannot be less than 0.' })
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
