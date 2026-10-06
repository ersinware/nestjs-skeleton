/**
 * @file post-admin-avatar.dto.ts
 * @description Declared avatar file details for the admin-owned account workflow.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsFileContentType, IsFileSize } from 'src/core/http';
import {
    AVATAR_CONTENT_TYPES,
    AVATAR_MAX_SIZE_BYTES,
    type AvatarContentType,
    type AvatarUploadDescriptor,
} from 'src/shared/domain/avatar';

/**
 * Required file details reused by initiation and finalization of the admin workflow.
 */
@ApiSchema({ name: 'PostAdminAvatar', description: 'Non-empty JPEG, PNG, or WebP avatar, at most 5 MiB.' })
export class PostAdminAvatarDto implements AvatarUploadDescriptor {
    /**
     * Expected avatar size in bytes; finalization must compare it with stored metadata.
     */
    @IsFileSize(AVATAR_MAX_SIZE_BYTES, 'The avatar size')
    readonly sizeBytes!: number;

    /**
     * Declared avatar media type; this field does not prove the file contents.
     */
    @IsFileContentType(AVATAR_CONTENT_TYPES, 'The avatar content type')
    readonly contentType!: AvatarContentType;
}
