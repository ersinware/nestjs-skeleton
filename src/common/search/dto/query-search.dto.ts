/**
 * @file query-search.dto.ts
 * @description Defines generic query parameters acceptable when fetching lists of items, extending base pagination with a generic search filter.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { QueryPaginationDto } from 'src/common/pagination/dto/query-pagination.dto';

/**
 * Generic query parameters for list endpoints.
 * Inherits standard pagination controls and adds a unified search term.
 */
@ApiSchema({ name: 'QuerySearch', description: 'Generic query parameters for pagination and search.' })
@Exclude()
export class QuerySearchDto extends QueryPaginationDto {
    /**
     * The optional generic search text used to perform pattern matching against entity fields.
     */
    @Expose()
    @IsOptional()
    @IsString({ message: 'Search term must be a string.' })
    @MinLength(1, { message: 'Search term must be at least 1 character long.' })
    @MaxLength(100, { message: 'Search term cannot be longer than 100 characters.' })
    @ApiProperty({
        type: 'string',
        required: false,
        minLength: 1,
        maxLength: 100,
        example: 'search keyword',
        description: 'The search term to filter results.',
    })
    readonly search?: string;
}
