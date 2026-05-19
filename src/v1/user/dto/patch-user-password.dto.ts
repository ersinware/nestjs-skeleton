import { ApiSchema } from '@nestjs/swagger';
import { IsStrongPassword } from '../decorator/password.decorator';

@ApiSchema({ name: 'PatchUserPassword', description: 'Schema for changing user password' })
export class PatchUserPasswordDto {
    @IsStrongPassword('The current password')
    readonly currentPassword!: string;

    @IsStrongPassword('The new password')
    readonly newPassword!: string;
}
