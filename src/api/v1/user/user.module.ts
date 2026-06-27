/**
 * @file user.module.ts
 * @description Configures the user domain of the application, binding the REST controllers, business services, and database repositories required for user management.
 */

import { Module } from '@nestjs/common';
import { TOKEN_USER_IDENTITY_PROVIDER } from '../auth/constant/auth.constant';
import { TOKEN_USERS_REPOSITORY } from './constant/user.constant';
import { UsersRepository } from './repository/users.repository';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserCacheListener } from './listener/user-cache.listener';
import { UserSessionListener } from './listener/user-session.listener';
import { HashingModule } from 'src/infrastructure/security/hashing/hashing.module';
import { SessionModule } from 'src/infrastructure/security/session/session.module';

/**
 * The module responsible for orchestrating user-related operations.
 * Registers the persistence layer (UsersRepository) and exposes the UserService for cross-domain usage.
 */
@Module({
    imports: [HashingModule, SessionModule],
    controllers: [UserController],
    providers: [
        UserService,
        UserCacheListener,
        UserSessionListener,
        {
            provide: TOKEN_USERS_REPOSITORY,
            useClass: UsersRepository,
        },
        {
            provide: TOKEN_USER_IDENTITY_PROVIDER,
            useExisting: UserService,
        },
    ],
    exports: [UserService, TOKEN_USER_IDENTITY_PROVIDER],
})
export class UserModule {}
