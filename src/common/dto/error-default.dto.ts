import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

@ApiSchema({ name: 'ErrorDefault', description: 'Standard error response schema' })
export class ErrorDefaultDto {
    @ApiProperty({
        type: 'integer',
        minimum: 400,
        maximum: 599,
        example: 400,
        description: 'HTTP Status Code',
    })
    @IsInt({ message: 'Status code must be an integer.' })
    @Min(400, { message: 'Status code cannot be less than 400.' })
    @Max(599, { message: 'Status code cannot be greater than 599.' })
    readonly statusCode!: number;

    @ApiProperty({
        type: [String],
        minItems: 1,
        example: ['This is an error message.', 'This is another error message.'],
        description: 'List of error messages detailing what went wrong',
    })
    @IsArray({ message: 'Message must be an array of strings.' })
    @IsString({ each: true, message: 'Each message must be a string.' })
    @ArrayMinSize(1, { message: 'There must be at least one error message.' })
    readonly message!: string[];

    @ApiProperty({
        type: 'string',
        example: 'Bad Request',
        description: 'Short description of the error status',
        minLength: 1,
        maxLength: 255,
    })
    @IsString({ message: 'Status text must be a string.' })
    @IsNotEmpty({ message: 'Status text cannot be empty.' })
    @MinLength(1, { message: 'Status text must be at least 1 character.' })
    @MaxLength(255, { message: 'Status text cannot exceed 255 characters.' })
    readonly statusText!: string;
}
