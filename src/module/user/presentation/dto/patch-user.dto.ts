/**
 * @file patch-user.dto.ts
 * @description Request schema for updating a user's display name.
 */

import { ApiSchema, PickType } from '@nestjs/swagger';
import { PostUserRegistrationDto } from 'src/module/user/presentation/dto/post-user-registration.dto';

/**
 * Required display name for profile updates.
 */
@ApiSchema({ name: 'PatchUser', description: 'Schema for updating the user display name' })
export class PatchUserDto extends PickType(PostUserRegistrationDto, ['name'] as const) {}
