/**
 * @file patch-user.dto.ts
 * @description Request schema for independently updating a user's display name and avatar.
 */

import { ApiProperty, ApiSchema, PartialType, PickType } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import { IsFileDescriptor, IsJwtToken } from 'src/core/http';
import { PostUserAvatarDto } from 'src/module/user/presentation/dto/post-user-avatar.dto';
import { PostUserRegistrationDto } from 'src/module/user/presentation/dto/post-user-registration.dto';

/**
 * Independent optional profile fields; omission preserves current values and null is rejected.
 */
@ApiSchema({ name: 'PatchUser', description: 'Schema for updating the user name, avatar, or both.' })
export class PatchUserDto extends PartialType(PickType(PostUserRegistrationDto, ['name'] as const), {
    skipNullProperties: false,
}) {
    /**
     * Uploaded file details; required together with the upload proof for an avatar change.
     */
    @ValidateIf((body: PatchUserDto) => body.avatar !== undefined || body.uploadToken !== undefined)
    @IsFileDescriptor(PostUserAvatarDto, { sizeBytes: 1024, contentType: 'image/png' }, 'The avatar descriptor')
    @ApiProperty({ required: false })
    readonly avatar?: PostUserAvatarDto;

    /**
     * Workflow-bound upload proof; required together with the avatar descriptor.
     */
    @ValidateIf((body: PatchUserDto) => body.avatar !== undefined || body.uploadToken !== undefined)
    @IsJwtToken('The upload token')
    @ApiProperty({ required: false })
    readonly uploadToken?: string;
}
