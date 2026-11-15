/**
 * @file post-user-avatar-change-initiate.dto.ts
 * @description Profile form used to initiate an authenticated user avatar upload.
 */

import { ApiSchema, IntersectionType, PartialType, PickType } from '@nestjs/swagger';
import { PostUserRegistrationDto } from 'src/module/user/presentation/dto/post-user-registration.dto';

/**
 * Required avatar descriptor and optional normalized name for a combined profile update.
 */
@ApiSchema({ name: 'PostUserAvatarChangeInitiate', description: 'Profile and avatar details for preparing an upload.' })
export class PostUserAvatarChangeInitiateDto extends IntersectionType(
    PickType(PostUserRegistrationDto, ['avatar'] as const),
    PartialType(PickType(PostUserRegistrationDto, ['name'] as const), {
        skipNullProperties: false,
    }),
) {}
