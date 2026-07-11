/**
 * @file query-pagination.dto.ts
 * @description Data Transfer Object defining query parameters for offset-based pagination.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose, Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_DEFAULT_PAGE } from 'src/shared/pagination';

/**
 * Common query parameters for pagination.
 */
@ApiSchema({ name: 'QueryPagination', description: 'Query parameters for pagination' })
@Exclude()
export class QueryPaginationDto {
    /**
     * The page number to retrieve.
     */
    @Expose()
    @IsOptional()
    @Type(() => Number)
    @Transform(({ value }) => (value ?? PAGINATION_DEFAULT_PAGE) as number)
    @IsInt({ message: 'Page must be an integer.' })
    @Min(1, { message: 'Page cannot be less than 1.' })
    @ApiProperty({
        type: 'integer',
        minimum: 1,
        default: PAGINATION_DEFAULT_PAGE,
        required: false,
        description: 'The page number to retrieve.',
    })
    readonly page: number = PAGINATION_DEFAULT_PAGE;

    /**
     * The number of items to retrieve per page.
     */
    @Expose()
    @IsOptional()
    @Type(() => Number)
    @Transform(({ value }) => (value ?? PAGINATION_DEFAULT_LIMIT) as number)
    @IsInt({ message: 'Limit must be an integer.' })
    @Min(1, { message: 'Limit cannot be less than 1.' })
    @Max(100, { message: 'Limit cannot be greater than 100.' })
    @ApiProperty({
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: PAGINATION_DEFAULT_LIMIT,
        required: false,
        description: 'The number of items to retrieve per page.',
    })
    readonly limit: number = PAGINATION_DEFAULT_LIMIT;
}
