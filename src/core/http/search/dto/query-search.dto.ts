/**
 * @file query-search.dto.ts
 * @description Query parameters for searchable list endpoints: pagination plus a free-text search term.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { QueryPaginationDto } from 'src/core/http/pagination/dto/query-pagination.dto';
import { Trim } from 'src/core/http/validation/decorator/trim.decorator';

const SEARCH_MIN_LENGTH = 1,
    SEARCH_MAX_LENGTH = 100;

/**
 * Extends pagination with an optional search term, so searchable list endpoints
 * share one input contract instead of redefining the field per module.
 */
@Exclude()
@ApiSchema({ name: 'QuerySearch', description: 'Generic query parameters for pagination and search.' })
export class QuerySearchDto extends QueryPaginationDto {
    /**
     * The free-text term the endpoint matches against its searchable fields.
     */
    @Expose()
    @IsOptional()
    @Trim()
    @IsString({ message: 'Search term must be a string.' })
    @MinLength(SEARCH_MIN_LENGTH, {
        message: `Search term must be at least ${SEARCH_MIN_LENGTH} character long.`,
    })
    @MaxLength(SEARCH_MAX_LENGTH, {
        message: `Search term cannot be longer than ${SEARCH_MAX_LENGTH} characters.`,
    })
    @ApiProperty({
        type: 'string',
        required: false,
        minLength: SEARCH_MIN_LENGTH,
        maxLength: SEARCH_MAX_LENGTH,
        example: 'search keyword',
        description: 'The search term to filter results.',
    })
    readonly search?: string;
}
