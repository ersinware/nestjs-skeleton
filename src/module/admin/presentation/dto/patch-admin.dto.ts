/**
 * @file patch-admin.dto.ts
 * @description Request schema for partial updates to an admin's profile.
 */

import { ApiSchema, PartialType } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { PostAdminDto } from 'src/module/admin/presentation/dto/post-admin.dto';

/**
 * Sparse payload for partial profile updates; the password has its own endpoint.
 */
@Exclude()
@ApiSchema({ name: 'PatchAdmin', description: 'Schema for updating an existing admin' })
export class PatchAdminDto extends PartialType(PostAdminDto) {}
