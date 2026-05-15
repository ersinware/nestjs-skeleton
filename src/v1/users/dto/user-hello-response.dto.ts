import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'UserHelloResponse', description: 'Response schema for the user hello endpoint' })
export class UserHelloResponseDto {
    @ApiProperty({
        example: 'Hello World!',
        description: 'Greeting message from the users service.',
    })
    readonly message!: string;
}
