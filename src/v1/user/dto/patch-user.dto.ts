import { ApiSchema, OmitType, PartialType } from '@nestjs/swagger';
import { PostUserDto } from './post-user.dto';

@ApiSchema({ name: 'PatchUser', description: 'Schema for updating an existing user' })
export class PatchUserDto extends PartialType(OmitType(PostUserDto, ['password'] as const)) {}
