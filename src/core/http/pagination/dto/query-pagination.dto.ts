/**
 * @file query-pagination.dto.ts
 * @description Query parameters for offset-based pagination, shared by every paginated list endpoint.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
    IsInt,
    IsOptional,
    Max,
    Min,
    Validate,
    ValidatorConstraint,
    type ValidationArguments,
    type ValidatorConstraintInterface,
} from 'class-validator';
import {
    PAGINATION_DEFAULT_LIMIT,
    PAGINATION_DEFAULT_PAGE,
    PAGINATION_MAX_LIMIT,
    PAGINATION_MAX_OFFSET,
} from 'src/shared/pagination';

/**
 * Rejects a page/limit combination whose resulting offset exceeds the maximum window.
 * The bound is a property of the pair, not of either field, so it cannot be expressed as a plain
 * `@Max` on `page`: at `limit=100` the tenth page is cheap while the ten-thousandth is a full scan.
 */
@ValidatorConstraint({ name: 'paginationWindow' })
class PaginationWindowConstraint implements ValidatorConstraintInterface {
    /**
     * Checks the resolved offset against the ceiling.
     *
     * @param page The requested page number
     * @param args The validation arguments carrying the sibling limit
     * @returns True when the offset stays within the allowed window
     */
    validate(page: number, args: ValidationArguments): boolean {
        const { limit } = args.object as QueryPaginationDto;

        // A non-numeric page or limit is already reported by its own rules; do not pile a second error on it.
        if (!Number.isInteger(page) || !Number.isInteger(limit)) {
            return true;
        }

        return (page - 1) * limit <= PAGINATION_MAX_OFFSET;
    }

    /**
     * Explains the ceiling in terms the client can act on, since neither field is wrong on its own.
     *
     * @returns The validation failure message
     */
    defaultMessage(): string {
        return `Page and limit combined cannot skip more than ${PAGINATION_MAX_OFFSET} items.`;
    }
}

/**
 * Shared input contract for offset-paginated list endpoints; both fields fall back
 * to their defaults when the client omits them.
 */
@ApiSchema({ name: 'QueryPagination', description: 'Query parameters for pagination' })
export class QueryPaginationDto {
    /**
     * The page number to retrieve.
     */
    @IsOptional()
    @Type(() => Number)
    @Transform(({ value }) => (value ?? PAGINATION_DEFAULT_PAGE) as number)
    @IsInt({ message: 'Page must be an integer.' })
    @Min(1, { message: 'Page cannot be less than 1.' })
    @Validate(PaginationWindowConstraint)
    @ApiProperty({
        type: 'integer',
        minimum: 1,
        default: PAGINATION_DEFAULT_PAGE,
        required: false,
        description: `The page number to retrieve. Page and limit combined cannot skip more than ${PAGINATION_MAX_OFFSET} items.`,
    })
    readonly page: number = PAGINATION_DEFAULT_PAGE;

    /**
     * The number of items to retrieve per page.
     */
    @IsOptional()
    @Type(() => Number)
    @Transform(({ value }) => (value ?? PAGINATION_DEFAULT_LIMIT) as number)
    @IsInt({ message: 'Limit must be an integer.' })
    @Min(1, { message: 'Limit cannot be less than 1.' })
    @Max(PAGINATION_MAX_LIMIT, { message: `Limit cannot be greater than ${PAGINATION_MAX_LIMIT}.` })
    @ApiProperty({
        type: 'integer',
        minimum: 1,
        maximum: PAGINATION_MAX_LIMIT,
        default: PAGINATION_DEFAULT_LIMIT,
        required: false,
        description: 'The number of items to retrieve per page.',
    })
    readonly limit: number = PAGINATION_DEFAULT_LIMIT;
}
