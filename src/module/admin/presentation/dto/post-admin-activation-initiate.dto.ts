/**
 * @file post-admin-activation-initiate.dto.ts
 * @description Activation form used to prepare the invited admin avatar upload.
 */

import { ApiSchema, OmitType } from '@nestjs/swagger';
import { PostAdminActivationDto } from 'src/module/admin/presentation/dto/post-admin-activation.dto';

/**
 * The final account form and avatar descriptor without an existing upload proof.
 */
@ApiSchema({
    name: 'PostAdminActivationInitiate',
    description: 'Account form and required avatar details for a fresh upload attempt.',
})
export class PostAdminActivationInitiateDto extends OmitType(PostAdminActivationDto, ['uploadToken'] as const) {}
