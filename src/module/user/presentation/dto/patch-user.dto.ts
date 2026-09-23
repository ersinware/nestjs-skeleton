/**
 * @file patch-user.dto.ts
 * @description Request schema for updating a user's display name.
 */

import { ApiSchema, PickType } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { PostUserDto } from 'src/module/user/presentation/dto/post-user.dto';

/**
 * Required display name for profile updates.
 */
@Exclude()
@ApiSchema({ name: 'PatchUser', description: 'Schema for updating the user display name' })
export class PatchUserDto extends PickType(PostUserDto, ['name'] as const) {}
