/**
 * @file query-audit-trail.dto.ts
 * @description Query parameters of the audit trail listing: pagination plus the indexed filters.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import {
    IsDate,
    IsEnum,
    IsOptional,
    Validate,
    ValidatorConstraint,
    type ValidationArguments,
    type ValidatorConstraintInterface,
} from 'class-validator';
import { IsEntityId, QueryPaginationDto } from 'src/core/http';
import { AuditAction } from 'src/core/observability/audit';

/**
 * Rejects a `from`/`to` pair whose lower bound lies after the upper bound. No single-field rule can
 * express it, and without it an inverted range would silently answer an empty page.
 */
@ValidatorConstraint({ name: 'auditTrailTimeRange' })
class TimeRangeConstraint implements ValidatorConstraintInterface {
    /**
     * @param from The requested lower bound
     * @param args The validation arguments carrying the sibling `to`
     * @returns True when either bound is absent or invalid, or `from` does not exceed `to`
     */
    validate(from: Date, args: ValidationArguments): boolean {
        const { to } = args.object as QueryAuditTrailDto;

        // An invalid date is already reported by its own rule.
        if (
            !(from instanceof Date) ||
            !(to instanceof Date) ||
            Number.isNaN(from.getTime()) ||
            Number.isNaN(to.getTime())
        ) {
            return true;
        }

        return from.getTime() <= to.getTime();
    }

    /**
     * @returns The validation failure message
     */
    defaultMessage(): string {
        return "The 'from' date cannot be later than the 'to' date.";
    }
}

/**
 * Narrows the audit trail listing. Only indexed columns are filterable, so any combination stays a
 * bounded read.
 */
@Exclude()
@ApiSchema({ name: 'QueryAuditTrail', description: 'Query parameters for filtering and paginating the audit trail.' })
export class QueryAuditTrailDto extends QueryPaginationDto {
    /**
     * The action to restrict the listing to.
     */
    @Expose()
    @IsOptional()
    @IsEnum(AuditAction, { message: 'The action must be a known audit action.' })
    @ApiProperty({
        type: String,
        enum: AuditAction,
        required: false,
        description: 'The audit action to restrict the listing to.',
        example: AuditAction.LOGIN_FAILED,
    })
    readonly action?: AuditAction;

    /**
     * The actor whose records to list.
     */
    @Expose()
    @IsEntityId('The actor ID', { optional: true })
    readonly actorId?: string;

    /**
     * The subject whose records to list.
     */
    @Expose()
    @IsEntityId('The target ID', { optional: true })
    readonly targetId?: string;

    /**
     * The inclusive lower bound of the record time.
     */
    @Expose()
    @IsOptional()
    @Type(() => Date)
    @IsDate({ message: 'The from date must be a valid ISO 8601 date-time.' })
    @Validate(TimeRangeConstraint)
    @ApiProperty({
        type: 'string',
        format: 'date-time',
        required: false,
        description:
            'The inclusive lower bound of the record time, as an ISO 8601 date-time. Cannot be later than `to`.',
        example: '2026-01-01T00:00:00.000Z',
    })
    readonly from?: Date;

    /**
     * The inclusive upper bound of the record time.
     */
    @Expose()
    @IsOptional()
    @Type(() => Date)
    @IsDate({ message: 'The to date must be a valid ISO 8601 date-time.' })
    @ApiProperty({
        type: 'string',
        format: 'date-time',
        required: false,
        description: 'The inclusive upper bound of the record time, as an ISO 8601 date-time.',
        example: '2026-12-31T23:59:59.999Z',
    })
    readonly to?: Date;
}
