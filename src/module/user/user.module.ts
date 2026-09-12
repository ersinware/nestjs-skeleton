/**
 * @file user.module.ts
 * @description NestJS wiring of the user bounded context.
 */

import { Module } from '@nestjs/common';
import { CacheModule } from 'src/core/cache';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { EmailModule } from 'src/core/email';
import { EventBusModule } from 'src/core/event-bus';
import { AuditModule } from 'src/core/observability/audit';
import { ErrorReporterModule } from 'src/core/observability/error-reporter';
import { HashingModule } from 'src/core/security/hashing';
import { SessionModule } from 'src/core/security/session';
import { BanUserCommandHandler } from 'src/module/user/application/command/ban-user/handler';
import { ChangeUserPasswordCommandHandler } from 'src/module/user/application/command/change-user-password/handler';
import { ChangeUserPermissionsCommandHandler } from 'src/module/user/application/command/change-user-permissions/handler';
import { DeleteUserCommandHandler } from 'src/module/user/application/command/delete-user/handler';
import { TOKEN_USER_WRITER_PORT } from 'src/module/user/application/command/port/user-writer.port';
import { ReconcileUserSessionCommandHandler } from 'src/module/user/application/command/reconcile-user-session/handler';
import { RegisterUserCommandHandler } from 'src/module/user/application/command/register-user/handler';
import { RevokeUserSessionsCommandHandler } from 'src/module/user/application/command/revoke-user-sessions/handler';
import { UnbanUserCommandHandler } from 'src/module/user/application/command/unban-user/handler';
import { UpdateUserCommandHandler } from 'src/module/user/application/command/update-user/handler';
import { UserCacheListener } from 'src/module/user/application/event/user-cache.listener';
import { UserSessionRevocationListener } from 'src/module/user/application/event/user-session-revocation.listener';
import { UserSessionListener } from 'src/module/user/application/event/user-session.listener';
import { GetUserAuthStateQueryHandler } from 'src/module/user/application/query/get-user-auth-state/handler';
import { TOKEN_GET_USER_AUTH_STATE_PORT } from 'src/module/user/application/query/get-user-auth-state/port';
import { GetUserByIdQueryHandler } from 'src/module/user/application/query/get-user-by-id/handler';
import { TOKEN_GET_USER_BY_ID_PORT } from 'src/module/user/application/query/get-user-by-id/port';
import { GetUserCredentialsByEmailQueryHandler } from 'src/module/user/application/query/get-user-credentials-by-email/handler';
import { TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT } from 'src/module/user/application/query/get-user-credentials-by-email/port';
import { TOKEN_GET_USER_SESSION_VERSION_PORT } from 'src/module/user/application/query/get-user-session-version/port';
import { ListUserPermissionCatalogQueryHandler } from 'src/module/user/application/query/list-user-permission-catalog/handler';
import { ListUsersQueryHandler } from 'src/module/user/application/query/list-users/handler';
import { TOKEN_LIST_USERS_PORT } from 'src/module/user/application/query/list-users/port';
import { UserReaderAdapter } from 'src/module/user/infrastructure/adapter/user-reader.adapter';
import { UserReplicaReaderAdapter } from 'src/module/user/infrastructure/adapter/user-replica-reader.adapter';
import { UserWriterAdapter } from 'src/module/user/infrastructure/adapter/user-writer.adapter';
import { UserController } from 'src/module/user/presentation/controller/user.controller';
import { UserFacade } from 'src/module/user/user.facade';

/**
 * Wires the user bounded context: binds every port token to its adapter, registers the handlers and
 * listeners, and exports only the facade — the sole surface other modules may consume.
 */
@Module({
    imports: [
        AuditModule,
        ErrorReporterModule,
        DatabaseModule,
        CacheModule,
        EventBusModule,
        HashingModule,
        SessionModule,
        EmailModule,
        CqrsPipelineModule,
    ],
    controllers: [UserController],
    providers: [
        UserFacade,
        RegisterUserCommandHandler,
        UpdateUserCommandHandler,
        ChangeUserPasswordCommandHandler,
        DeleteUserCommandHandler,
        BanUserCommandHandler,
        UnbanUserCommandHandler,
        ChangeUserPermissionsCommandHandler,
        RevokeUserSessionsCommandHandler,
        ReconcileUserSessionCommandHandler,
        ListUsersQueryHandler,
        ListUserPermissionCatalogQueryHandler,
        GetUserByIdQueryHandler,
        GetUserCredentialsByEmailQueryHandler,
        GetUserAuthStateQueryHandler,
        UserCacheListener,
        UserSessionRevocationListener,
        UserSessionListener,
        { provide: TOKEN_USER_WRITER_PORT, useClass: UserWriterAdapter },
        { provide: TOKEN_GET_USER_AUTH_STATE_PORT, useClass: UserReaderAdapter },
        { provide: TOKEN_GET_USER_SESSION_VERSION_PORT, useClass: UserReaderAdapter },
        { provide: TOKEN_GET_USER_BY_ID_PORT, useClass: UserReaderAdapter },
        { provide: TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT, useClass: UserReaderAdapter },
        { provide: TOKEN_LIST_USERS_PORT, useClass: UserReplicaReaderAdapter },
    ],
    exports: [UserFacade],
})
export class UserModule {}
