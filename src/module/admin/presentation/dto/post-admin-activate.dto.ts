/**
 * @file post-admin-activate.dto.ts
 * @description Request schema for activating a pending admin account.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsFileDescriptor, IsJwtToken, IsStrongPassword } from 'src/core/http';
import { PostAdminAvatarDto } from 'src/module/admin/presentation/dto/post-admin-avatar.dto';

/**
 * Final activation form; invitation proof and avatar upload proof have distinct purposes.
 */
@ApiSchema({ name: 'PostAdminActivate', description: 'Input validation schema for admin account activation.' })
export class PostAdminActivateDto {
    /**
     * The invite token from the invitation email.
     */
    @IsJwtToken('The invite token')
    readonly token!: string;

    /**
     * The plain-text initial password, hashed before persistence.
     */
    @IsStrongPassword()
    readonly password!: string;

    /**
     * File details bound to the form during initiation and checked against the uploaded object.
     */
    @IsFileDescriptor(PostAdminAvatarDto, { sizeBytes: 1024, contentType: 'image/png' }, 'The avatar descriptor')
    readonly avatar!: PostAdminAvatarDto;

    /**
     * Workflow-bound upload proof returned by initiation; never an invitation or session token.
     */
    @IsJwtToken('The upload token')
    readonly uploadToken!: string;
}
