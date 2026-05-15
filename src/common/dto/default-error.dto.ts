import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'DefaultError', description: 'Standard error response schema' })
export class DefaultErrorDto {
    @ApiProperty({
        example: 400,
        description: 'HTTP Status Code',
    })
    readonly statusCode!: number;

    @ApiProperty({
        example: ['This is an error message.', 'This is another error message.'],
        description: 'List of error messages',
        type: [String],
    })
    readonly message!: string[];

    @ApiProperty({
        example: 'Bad Request',
        description: 'Short description of the error',
    })
    readonly error!: string;
}
