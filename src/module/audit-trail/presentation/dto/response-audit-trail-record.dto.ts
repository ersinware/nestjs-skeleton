/**
 * @file response-audit-trail-record.dto.ts
 * @description Response schema for one audit trail record.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEntityId } from 'src/core/http';
import { AuditAction, type AuditDetail } from 'src/core/observability/audit';
import { PrincipalType } from 'src/shared/domain/principal';

/**
 * Exposes every column of an audit trail record: all of it is evidence, and only a holder of the
 * audit-trail read permission can read it. Nullable fields are null when the record was written outside an HTTP request or
 * without a verified actor.
 */
@Exclude()
@ApiSchema({ name: 'ResponseAuditTrailRecord', description: 'One record of the audit trail.' })
export class ResponseAuditTrailRecordDto {
    /**
     * The unique identifier of the record; UUID v7, so id order is time order.
     */
    @Expose()
    @IsEntityId('The record ID')
    readonly id!: string;

    /**
     * What happened; each action states its own outcome.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: AuditAction,
        description: 'What happened.',
        example: AuditAction.LOGIN_FAILED,
    })
    readonly action!: AuditAction;

    /**
     * Why a refusal happened; null on an action that cannot fail.
     */
    @Expose()
    @ApiProperty({
        type: String,
        description: 'Why a refusal happened; null on an action that cannot fail.',
        example: 'INVALID_CREDENTIALS',
        nullable: true,
    })
    readonly reason!: string | null;

    /**
     * What the action changed, when the ids alone do not say; null on an action whose meaning the
     * ids carry in full.
     */
    @Expose()
    @ApiProperty({
        type: 'object',
        additionalProperties: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        description: 'What the action changed, when the ids alone do not say; null otherwise.',
        example: { granted: ['user:account:read'], revoked: [] },
        nullable: true,
    })
    readonly detail!: AuditDetail | null;

    /**
     * The subject the action was applied to.
     */
    @Expose()
    @ApiProperty({
        type: 'string',
        format: 'uuid',
        description: 'The subject the action was applied to.',
        example: '018f43c3-6bb3-7d72-911e-848821a837c3',
        nullable: true,
    })
    readonly targetId!: string | null;

    /**
     * The verified principal who acted; null on a public route or outside a request.
     */
    @Expose()
    @ApiProperty({
        type: 'string',
        format: 'uuid',
        description: 'The verified principal who acted; null on a public route or outside a request.',
        example: '018f43c3-6bb3-7d72-911e-848821a837c3',
        nullable: true,
    })
    readonly actorId!: string | null;

    /**
     * The kind of the verified principal, so `actorId` resolves to its owning context.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: PrincipalType,
        description: 'The kind of the verified principal who acted, naming the context that owns `actorId`.',
        example: PrincipalType.ADMIN,
        nullable: true,
    })
    readonly actorType!: PrincipalType | null;

    /**
     * The client address as resolved by proxy trust; null outside an HTTP request.
     */
    @Expose()
    @ApiProperty({
        type: String,
        description: 'The client address; null outside an HTTP request.',
        example: '203.0.113.7',
        nullable: true,
    })
    readonly remoteAddress!: string | null;

    /**
     * The matched route template, never the raw URL.
     */
    @Expose()
    @ApiProperty({
        type: String,
        description: 'The matched route template; null outside an HTTP request.',
        example: '/v1/user/:id',
        nullable: true,
    })
    readonly route!: string | null;

    /**
     * The HTTP method of the request.
     */
    @Expose()
    @ApiProperty({
        type: String,
        description: 'The HTTP method of the request; null outside an HTTP request.',
        example: 'GET',
        nullable: true,
    })
    readonly method!: string | null;

    /**
     * The client-supplied user agent, length-capped at write time.
     */
    @Expose()
    @ApiProperty({
        type: String,
        description: 'The client-supplied user agent; null outside an HTTP request.',
        example: 'Mozilla/5.0',
        nullable: true,
    })
    readonly userAgent!: string | null;

    /**
     * The trace active at write time, for correlation with the tracing backend.
     */
    @Expose()
    @ApiProperty({
        type: String,
        description: 'The trace id active at write time.',
        example: '4bf92f3577b34da6a3ce929d0e0e4736',
        nullable: true,
    })
    readonly traceId!: string | null;

    /**
     * When the action happened.
     */
    @Expose()
    @ApiProperty({
        type: 'string',
        format: 'date-time',
        description: 'When the action happened.',
        example: '2026-01-01T12:00:00.000Z',
    })
    readonly occurredAt!: Date;
}
