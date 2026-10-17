/**
 * @file post-user-registration.dto.ts
 * @description Request schema for registering a new user.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsEmailAddress, IsFileDescriptor, IsJwtToken, IsPersonName, IsStrongPassword } from 'src/core/http';
import { PostUserAvatarDto } from 'src/module/user/presentation/dto/post-user-avatar.dto';

/**
 * Final registration form with the declared avatar and its workflow-bound upload proof.
 */
@ApiSchema({ name: 'PostUserRegistration', description: 'Input for creating a pending user account.' })
export class PostUserRegistrationDto {
    /**
     * The unique email address to associate with the new account.
     */
    @IsEmailAddress()
    readonly email!: string;

    /**
     * The full real name or display name of the user.
     */
    @IsPersonName()
    readonly name!: string;

    /**
     * The password chosen at registration, hashed before persistence and required for activation.
     */
    @IsStrongPassword()
    readonly password!: string;

    /**
     * File details bound to the form during initiation and checked against the uploaded object.
     */
    @IsFileDescriptor(PostUserAvatarDto, { sizeBytes: 1024, contentType: 'image/png' }, 'The avatar descriptor')
    readonly avatar!: PostUserAvatarDto;

    /**
     * Workflow-bound upload proof returned by initiation; never an invitation or session token.
     */
    @IsJwtToken('The upload token')
    readonly uploadToken!: string;
}
