/**
 * @file patch-user.dto.ts
 * @description Defines the validation schema for allowing users to update their non-sensitive profile information.
 */

import { ApiSchema, OmitType, PartialType } from '@nestjs/swagger';
import { PostUserDto } from 'src/module/user/presentation/dto/post-user.dto';

/**
 * The sparse payload used for partial updates to a user's profile.
 * Explicitly omits sensitive fields like passwords which require dedicated endpoints.
 */
@ApiSchema({ name: 'PatchUser', description: 'Schema for updating an existing user' })
export class PatchUserDto extends PartialType(OmitType(PostUserDto, ['password'] as const)) {}
