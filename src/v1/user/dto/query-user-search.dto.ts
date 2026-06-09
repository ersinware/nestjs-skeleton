/**
 * @file query-user-search.dto.ts
 * @description Data transfer object defining query parameters for user search.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { QueryPaginationDto } from 'src/common/dto/query-pagination.dto';

/**
 * DTO representing query parameters for user search.
 * Extends standard pagination to add a search query string.
 */
@ApiSchema({ name: 'QueryUserSearch', description: 'Query parameters for user search.' })
@Exclude()
export class QueryUserSearchDto extends QueryPaginationDto {
    /**
     * The search term to filter users by name or email.
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
        example: 'John Doe',
        description: 'The search term to filter users by name or email.',
    })
    readonly search?: string;
}
