/**
 * @file error-default.dto.ts
 * @description Data Transfer Object defining the structure of standard error responses.
 * Used to ensure uniform error presentation across all API endpoints in compliance with OpenAPI/Swagger.
 */

import { HttpStatus } from '@nestjs/common';
import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/**
 * Standard error response schema that represents details of a failed HTTP request.
 * Implements a strict whitelist approach (Exclude/Expose) to guarantee no internal fields leak.
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
    readonly statusCode!: HttpStatus;

    /**
     * A list of human-readable error messages detailing what went wrong.
     */
    @Expose()
    @ApiProperty({
        type: [String],
        isArray: true,
        minItems: 1,
        description: 'List of error messages detailing what went wrong',
        example: ['This is an error message.', 'This is another error message.'],
    })
    readonly message!: string[];

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
    readonly statusText!: string;

    /**
     * Creates the error response, so the global exception filter always emits a real instance of
     * this class rather than a structurally similar object literal.
     *
     * @param fields The status code, messages, and status text of the failed request
     */
    constructor(fields: { statusCode: HttpStatus; message: string[]; statusText: string }) {
        this.statusCode = fields.statusCode;
        this.message = fields.message;
        this.statusText = fields.statusText;
    }
}
