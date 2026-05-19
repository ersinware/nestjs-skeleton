import { ApiSchema } from '@nestjs/swagger';
import { IsUserEmail } from '../decorator/email.decorator';
import { IsUserName } from '../decorator/name.decorator';
import { IsStrongPassword } from '../decorator/password.decorator';

@ApiSchema({ name: 'PostUser', description: 'Schema for creating a new user' })
export class PostUserDto {
    @IsUserEmail('The email address')
    readonly email!: string;

    @IsUserName('The full name')
    readonly name!: string;

    @IsStrongPassword('The password')
    readonly password!: string;
}
