/**
 * @file post-user-registration-initiate.dto.ts
 * @description Registration form used to prepare the required user avatar upload.
 */

import { ApiSchema, OmitType } from '@nestjs/swagger';
import { PostUserRegistrationDto } from 'src/module/user/presentation/dto/post-user-registration.dto';

/**
 * The final account form and avatar descriptor without an existing upload proof.
 */
@ApiSchema({
    name: 'PostUserRegistrationInitiate',
    description: 'Account form and required avatar details for a fresh upload attempt.',
})
export class PostUserRegistrationInitiateDto extends OmitType(PostUserRegistrationDto, ['uploadToken'] as const) {}
