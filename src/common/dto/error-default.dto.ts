/**
 * @file error-default.dto.ts
 * @description Data Transfer Object defining the structure of standard error responses.
 * Used to ensure uniform error presentation across all API endpoints in compliance with OpenAPI/Swagger.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Standard error response schema that represents details of a failed HTTP request.
 */
@ApiSchema({ name: 'ErrorDefault', description: 'Standard error response schema' })
export class ErrorDefaultDto {
    /**
     * The HTTP status code indicating the type of failure.
     */
    @IsInt({ message: 'Status code must be an integer.' })
    @Min(400, { message: 'Status code cannot be less than 400.' })
    @Max(599, { message: 'Status code cannot be greater than 599.' })
    @ApiProperty({
        type: 'integer',
        minimum: 400,
        maximum: 599,
        description: 'HTTP Status Code',
        example: 400,
    })
    readonly statusCode!: number;

    /**
     * A list of human-readable error messages detailing what went wrong.
     */
    @IsArray({ message: 'Message must be an array of strings.' })
    @IsString({ each: true, message: 'Each message must be a string.' })
    @ArrayMinSize(1, { message: 'There must be at least one error message.' })
    @ApiProperty({
        type: [String],
        minItems: 1,
        description: 'List of error messages detailing what went wrong',
        example: ['This is an error message.', 'This is another error message.'],
    })
    readonly message!: string[];

    /**
     * A short, standard text description of the HTTP error status.
     */
    @IsString({ message: 'Status text must be a string.' })
    @IsNotEmpty({ message: 'Status text cannot be empty.' })
    @MinLength(1, { message: 'Status text must be at least 1 character.' })
    @MaxLength(255, { message: 'Status text cannot exceed 255 characters.' })
    @ApiProperty({
        type: 'string',
        minLength: 1,
        maxLength: 255,
        description: 'Short description of the error status',
        example: 'Bad Request',
    })
    readonly statusText!: string;
}
