/**
 * @file post-user-initiate.dto.ts
 * @description Initiation payload for the user-owned avatar upload workflow.
 */

import { ApiSchema, OmitType } from '@nestjs/swagger';
import { PostUserDto } from 'src/module/user/presentation/dto/post-user.dto';

/**
 * The final account form and avatar descriptor without an existing upload proof.
 */
@ApiSchema({
    name: 'PostUserInitiate',
    description: 'Account form and required avatar details for a fresh upload attempt.',
})
export class PostUserInitiateDto extends OmitType(PostUserDto, ['uploadToken'] as const) {}
