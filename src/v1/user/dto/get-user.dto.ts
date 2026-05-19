import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsUserEmail } from '../decorator/email.decorator';
import { IsUserName } from '../decorator/name.decorator';

@ApiSchema({ name: 'GetUser', description: 'Standard user response schema excluding sensitive data' })
@Exclude()
export class GetUserDto {
    @IsUserEmail('The email address')
    @Expose()
    readonly email!: string;

    @IsUserName('The full name')
    @Expose()
    readonly name!: string;
}
