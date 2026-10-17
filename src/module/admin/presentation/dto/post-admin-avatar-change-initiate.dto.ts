/**
 * @file post-admin-avatar-change-initiate.dto.ts
 * @description Profile form used to initiate an authenticated admin avatar upload.
 */

import { ApiSchema, PartialType, PickType } from '@nestjs/swagger';
import { IsFileDescriptor } from 'src/core/http';
import { PostAdminAvatarDto } from 'src/module/admin/presentation/dto/post-admin-avatar.dto';
import { PostAdminInviteDto } from 'src/module/admin/presentation/dto/post-admin-invite.dto';

/**
 * Required avatar descriptor and optional normalized name for a combined profile update.
 */
@ApiSchema({ name: 'PostAdminAvatarChangeInitiate', description: 'Profile fields bound to a new avatar upload.' })
export class PostAdminAvatarChangeInitiateDto extends PartialType(PickType(PostAdminInviteDto, ['name'] as const), {
    skipNullProperties: false,
}) {
    /**
     * File details bound to the form and checked against uploaded metadata at acceptance.
     */
    @IsFileDescriptor(PostAdminAvatarDto, { sizeBytes: 1024, contentType: 'image/png' }, 'The avatar descriptor')
    readonly avatar!: PostAdminAvatarDto;
}
