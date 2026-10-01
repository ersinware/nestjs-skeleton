/**
 * @file response-single-upload-initiate.dto.ts
 * @description Shared initiation response carrying a single signed PUT plan and its finalization proof.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { IsJwtToken } from 'src/core/http/validation/decorator/jwt-token.decorator';

/**
 * Client-visible PUT details; no signing credentials or provider response metadata are exposed.
 */
@Exclude()
@ApiSchema({ name: 'ResponseSignedUploadRequest', description: 'One signed PUT request with its fixed deadline.' })
export class ResponseSignedUploadRequestDto {
    /**
     * Signed URL used verbatim by the browser.
     */
    @Expose()
    @ApiProperty({
        type: String,
        format: 'uri',
        description: 'Presigned PUT URL; use it without rewriting its host, path, or query.',
        example: 'https://storage.example.com/avatars/pending/avatar/user/018f43c3-6bb3-7d72-911e-848821a837c3',
    })
    readonly url!: string;

    /**
     * Required signed headers supplied by the workflow for the PUT.
     */
    @Expose()
    @ApiProperty({
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Send every supplied header with the PUT request.',
        example: { 'content-type': 'image/png', 'if-none-match': '*', 'cache-control': 'no-store' },
    })
    readonly headers!: Readonly<Record<string, string>>;

    /**
     * Actual URL expiry; the upload proof does not extend this deadline.
     */
    @Expose()
    @ApiProperty({
        type: String,
        format: 'date-time',
        description: 'Absolute URL expiration time; this plan cannot be refreshed.',
        example: '2026-10-01T12:05:00.000Z',
    })
    readonly expiresAt!: Date;
}

/**
 * A single PUT plan and the proof needed to finalize the owning workflow.
 */
@Exclude()
@ApiSchema({
    name: 'ResponseSingleUploadInitiate',
    description: 'One signed PUT request and its form-bound finalization proof.',
})
export class ResponseSingleUploadInitiateDto {
    /**
     * The only transfer mode permitted by this response contract.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: ['single'],
        description: 'Upload the whole file with one conditional PUT.',
        example: 'single',
    })
    readonly mode!: 'single';

    /**
     * The sole signed request authorized for this attempt.
     */
    @Expose()
    @Type(() => ResponseSignedUploadRequestDto)
    @ApiProperty({
        type: ResponseSignedUploadRequestDto,
        description: 'Signed request for the whole file.',
        example: {
            url: 'https://storage.example.com/avatars/pending/avatar/user/018f43c3-6bb3-7d72-911e-848821a837c3',
            headers: { 'content-type': 'image/png', 'if-none-match': '*', 'cache-control': 'no-store' },
            expiresAt: '2026-10-01T12:05:00.000Z',
        },
    })
    readonly request!: ResponseSignedUploadRequestDto;

    /**
     * Upload proof for finalization, distinct from any invitation or session token.
     */
    @Expose()
    @IsJwtToken('The upload token')
    readonly uploadToken!: string;
}
