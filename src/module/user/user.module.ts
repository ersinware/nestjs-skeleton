/**
 * @file user.module.ts
 * @description Configures the user domain of the application, binding the REST controllers, business services, and database repositories required for user management.
 */

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { EmailModule } from 'src/core/email/module';
import { HashingModule, SessionModule } from 'src/core/security';
import { BanUserCommandHandler } from 'src/module/user/application/command/ban-user';
import { ChangeUserPasswordCommandHandler } from 'src/module/user/application/command/change-user-password';
import { CreateUserCommandHandler } from 'src/module/user/application/command/create-user';
import { DeleteUserCommandHandler } from 'src/module/user/application/command/delete-user';
import { TOKEN_USER_WRITER_PORT } from 'src/module/user/application/command/port';
import { RevokeUserSessionsCommandHandler } from 'src/module/user/application/command/revoke-user-sessions';
import { UnbanUserCommandHandler } from 'src/module/user/application/command/unban-user';
import { UpdateUserCommandHandler } from 'src/module/user/application/command/update-user';
import { UserCacheListener, UserReuseListener, UserSessionListener } from 'src/module/user/application/event';
import { TOKEN_GET_USER_ACCESS_PROJECTION_PORT } from 'src/module/user/application/query/get-user-access-projection';
import {
    GetUserAuthStateQueryHandler,
    TOKEN_GET_USER_AUTH_STATE_PORT,
} from 'src/module/user/application/query/get-user-auth-state';
import { GetUserByIdQueryHandler, TOKEN_GET_USER_BY_ID_PORT } from 'src/module/user/application/query/get-user-by-id';
import {
    GetUserCredentialsByEmailQueryHandler,
    TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT,
} from 'src/module/user/application/query/get-user-credentials-by-email';
import { ListUsersQueryHandler, TOKEN_LIST_USERS_PORT } from 'src/module/user/application/query/list-users';
import { UserReaderAdapter, UserWriterAdapter } from 'src/module/user/infrastructure/adapter';
import { UserController } from 'src/module/user/presentation/controller/user.controller';
import { UserFacade } from 'src/module/user/user.facade';

/**
 * The module responsible for orchestrating user-related operations.
 * Registers both the write repository (aggregate-based) and the read/query repository (projection-based),
 * and exposes the UserFacade for cross-domain usage.
 */
@Module({
    imports: [HashingModule, SessionModule, EmailModule, CqrsModule],
    controllers: [UserController],
    providers: [
        UserFacade,
        CreateUserCommandHandler,
        UpdateUserCommandHandler,
        ChangeUserPasswordCommandHandler,
        DeleteUserCommandHandler,
        BanUserCommandHandler,
        UnbanUserCommandHandler,
        RevokeUserSessionsCommandHandler,
        ListUsersQueryHandler,
        GetUserByIdQueryHandler,
        GetUserCredentialsByEmailQueryHandler,
        GetUserAuthStateQueryHandler,
        UserCacheListener,
        UserReuseListener,
        UserSessionListener,
        { provide: TOKEN_USER_WRITER_PORT, useClass: UserWriterAdapter },
        { provide: TOKEN_GET_USER_AUTH_STATE_PORT, useClass: UserReaderAdapter },
        { provide: TOKEN_GET_USER_ACCESS_PROJECTION_PORT, useClass: UserReaderAdapter },
        { provide: TOKEN_GET_USER_BY_ID_PORT, useClass: UserReaderAdapter },
        { provide: TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT, useClass: UserReaderAdapter },
        { provide: TOKEN_LIST_USERS_PORT, useClass: UserReaderAdapter },
    ],
    exports: [UserFacade],
})
export class UserModule {}
