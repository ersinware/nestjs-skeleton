/**
 * @file error-default.dto.ts
 * @description Standard error response DTO keeping error presentation uniform across all endpoints.
 */

import { HttpStatus } from '@nestjs/common';
import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/**
 * Standard error response schema for a failed HTTP request.
 */
@Exclude()
@ApiSchema({ name: 'ErrorDefault', description: 'Standard error response schema' })
export class ErrorDefaultDto {
    /**
     * The HTTP status code indicating the type of failure.
     */
    @Expose()
    @ApiProperty({
        type: 'integer',
        minimum: 400,
        maximum: 599,
        description: 'HTTP Status Code',
        example: 400,
    })
    readonly statusCode: HttpStatus;

    /**
     * A list of human-readable error messages detailing what went wrong.
     */
    @Expose()
    @ApiProperty({
        type: 'string',
        isArray: true,
        minItems: 1,
        description: 'List of error messages detailing what went wrong',
        example: ['This is an error message.', 'This is another error message.'],
    })
    readonly message: readonly string[];

    /**
     * A short, standard text description of the HTTP error status.
     */
    @Expose()
    @ApiProperty({
        type: 'string',
        minLength: 1,
        maxLength: 255,
        description: 'Short description of the error status',
        example: 'Bad Request',
    })
    readonly statusText: string;

    /**
     * Constructs a real class instance — serialization keys off the class metadata, which a
     * structurally similar object literal would not carry.
     *
     * @param fields.statusCode HTTP status assigned to the failed request.
     * @param fields.message Client-safe descriptions of the failure.
     * @param fields.statusText Short status description exposed in the error response.
     */
    constructor(fields: {
        readonly statusCode: HttpStatus;
        readonly message: readonly string[];
        readonly statusText: string;
    }) {
        this.statusCode = fields.statusCode;
        this.message = fields.message;
        this.statusText = fields.statusText;
    }
}
