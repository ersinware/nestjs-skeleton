/**
 * @file patch-user.dto.ts
 * @description Request schema for partial updates to a user's profile.
 */

import { ApiSchema, OmitType, PartialType } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { PostUserDto } from 'src/module/user/presentation/dto/post-user.dto';

/**
 * Sparse payload for partial profile updates. Omits the password, which has its own endpoint.
 */
@Exclude()
@ApiSchema({ name: 'PatchUser', description: 'Schema for updating an existing user' })
export class PatchUserDto extends PartialType(OmitType(PostUserDto, ['password'] as const)) {}
