/**
 * @file patch-user.dto.ts
 * @description Data transfer object defining the structure of a partial user profile update.
 */

import { ApiSchema, OmitType, PartialType } from '@nestjs/swagger';
import { PostUserDto } from './post-user.dto';

/**
 * DTO representing fields available for partial user profile updates.
 */
@ApiSchema({ name: 'PatchUser', description: 'Schema for updating an existing user' })
export class PatchUserDto extends PartialType(OmitType(PostUserDto, ['password'] as const)) {}
