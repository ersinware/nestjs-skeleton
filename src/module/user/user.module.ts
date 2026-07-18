/**
 * @file user.module.ts
 * @description Configures the user domain of the application, binding the REST controllers, business services, and database repositories required for user management.
 */

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { EmailModule } from 'src/core/email';
import { HashingModule } from 'src/core/security/hashing';
import { SessionModule } from 'src/core/security/session';
import { BanUserCommandHandler } from 'src/module/user/application/command/ban-user/handler';
import { ChangeUserPasswordCommandHandler } from 'src/module/user/application/command/change-user-password/handler';
import { CreateUserCommandHandler } from 'src/module/user/application/command/create-user/handler';
import { DeleteUserCommandHandler } from 'src/module/user/application/command/delete-user/handler';
import { TOKEN_USER_WRITER_PORT } from 'src/module/user/application/command/port/user-writer.port';
import { RevokeUserSessionsCommandHandler } from 'src/module/user/application/command/revoke-user-sessions/handler';
import { UnbanUserCommandHandler } from 'src/module/user/application/command/unban-user/handler';
import { UpdateUserCommandHandler } from 'src/module/user/application/command/update-user/handler';
import { UserCacheListener } from 'src/module/user/application/event/user-cache.listener';
import { UserReuseListener } from 'src/module/user/application/event/user-reuse.listener';
import { UserSessionListener } from 'src/module/user/application/event/user-session.listener';
import { TOKEN_GET_USER_ACCESS_PROJECTION_PORT } from 'src/module/user/application/query/get-user-access-projection/port';
import { GetUserAuthStateQueryHandler } from 'src/module/user/application/query/get-user-auth-state/handler';
import { TOKEN_GET_USER_AUTH_STATE_PORT } from 'src/module/user/application/query/get-user-auth-state/port';
import { GetUserByIdQueryHandler } from 'src/module/user/application/query/get-user-by-id/handler';
import { TOKEN_GET_USER_BY_ID_PORT } from 'src/module/user/application/query/get-user-by-id/port';
import { GetUserCredentialsByEmailQueryHandler } from 'src/module/user/application/query/get-user-credentials-by-email/handler';
import { TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT } from 'src/module/user/application/query/get-user-credentials-by-email/port';
import { ListUsersQueryHandler } from 'src/module/user/application/query/list-users/handler';
import { TOKEN_LIST_USERS_PORT } from 'src/module/user/application/query/list-users/port';
import { UserReaderAdapter } from 'src/module/user/infrastructure/adapter/user-reader.adapter';
import { UserWriterAdapter } from 'src/module/user/infrastructure/adapter/user-writer.adapter';
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
