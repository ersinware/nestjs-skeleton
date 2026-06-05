/**
 * @file user.module.ts
 * @description NestJS module configuring the controllers, services, and repository layers for user domain.
 */

import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TOKEN_USERS_REPOSITORY } from './constant/user.constant';
import { UsersRepository } from './repository/users.repository';
import { UserController } from './user.controller';
import { UserService } from './user.service';

/**
 * Module responsible for orchestrating user-related operations and registering dependencies.
 */
@Module({
    imports: [forwardRef(() => AuthModule)],
    controllers: [UserController],
    providers: [
        UserService,
        {
            provide: TOKEN_USERS_REPOSITORY,
            useClass: UsersRepository,
        },
    ],
    exports: [UserService, TOKEN_USERS_REPOSITORY],
})
export class UserModule {}
