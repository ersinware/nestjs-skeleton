/**
 * @file patch-admin.dto.ts
 * @description Request schema for partial updates to an admin's profile.
 */

import { ApiSchema, OmitType, PartialType } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { PostAdminDto } from 'src/module/admin/presentation/dto/post-admin.dto';

/**
 * Sparse payload for partial profile updates. Omits the password, which has its own endpoint.
 */
@Exclude()
@ApiSchema({ name: 'PatchAdmin', description: 'Schema for updating an existing admin' })
export class PatchAdminDto extends PartialType(OmitType(PostAdminDto, ['password'] as const)) {}
