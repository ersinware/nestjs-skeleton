/**
 * @file post-admin-activate-initiate.dto.ts
 * @description Initiation payload for the admin-owned avatar upload workflow.
 */

import { ApiSchema, OmitType } from '@nestjs/swagger';
import { PostAdminActivateDto } from 'src/module/admin/presentation/dto/post-admin-activate.dto';

/**
 * The final account form and avatar descriptor without an existing upload proof.
 */
@ApiSchema({
    name: 'PostAdminActivateInitiate',
    description: 'Account form and required avatar details for a fresh upload attempt.',
})
export class PostAdminActivateInitiateDto extends OmitType(PostAdminActivateDto, ['uploadToken'] as const) {}
