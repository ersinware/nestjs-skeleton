/**
 * @file patch-admin.dto.ts
 * @description Request schema for updating an admin's display name.
 */

import { ApiSchema, PickType } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { PostAdminDto } from 'src/module/admin/presentation/dto/post-admin.dto';

/**
 * Required display name for profile updates.
 */
@Exclude()
@ApiSchema({ name: 'PatchAdmin', description: 'Schema for updating the admin display name' })
export class PatchAdminDto extends PickType(PostAdminDto, ['name'] as const) {}
