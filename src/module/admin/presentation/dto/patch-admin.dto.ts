/**
 * @file patch-admin.dto.ts
 * @description Request schema for independently updating an admin's display name and avatar.
 */

import { ApiProperty, ApiSchema, PartialType, PickType } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import { IsFileDescriptor, IsJwtToken } from 'src/core/http';
import { PostAdminAvatarDto } from 'src/module/admin/presentation/dto/post-admin-avatar.dto';
import { PostAdminInviteDto } from 'src/module/admin/presentation/dto/post-admin-invite.dto';

/**
 * Independent optional profile fields; omission preserves current values and null is rejected.
 */
@ApiSchema({ name: 'PatchAdmin', description: 'Schema for updating the admin name, avatar, or both.' })
export class PatchAdminDto extends PartialType(PickType(PostAdminInviteDto, ['name'] as const), {
    skipNullProperties: false,
}) {
    /**
     * Uploaded file details; required together with the upload proof for an avatar change.
     */
    @ValidateIf((body: PatchAdminDto) => body.avatar !== undefined || body.uploadToken !== undefined)
    @IsFileDescriptor(PostAdminAvatarDto, { sizeBytes: 1024, contentType: 'image/png' }, 'The avatar descriptor')
    @ApiProperty({ required: false })
    readonly avatar?: PostAdminAvatarDto;

    /**
     * Workflow-bound upload proof; required together with the avatar descriptor.
     */
    @ValidateIf((body: PatchAdminDto) => body.avatar !== undefined || body.uploadToken !== undefined)
    @IsJwtToken('The upload token')
    @ApiProperty({ required: false })
    readonly uploadToken?: string;
}
