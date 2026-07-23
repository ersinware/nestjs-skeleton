/**
 * @file auth.module.ts
 * @description Configures the authentication domain of the application. It bundles the controllers, services, and security dependencies required for authenticating users and managing sessions.
 */

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { EventBusModule } from 'src/core/event-bus';
import { AuditModule } from 'src/core/observability/audit';
import { HashingModule } from 'src/core/security/hashing';
import { SessionModule } from 'src/core/security/session';
import { TokenModule } from 'src/core/security/token';
import { AdminModule } from 'src/module/admin';
import { LoginAdminCommandHandler } from 'src/module/auth/application/command/login-admin/handler';
import { LoginUserCommandHandler } from 'src/module/auth/application/command/login-user/handler';
import { LogoutAllCommandHandler } from 'src/module/auth/application/command/logout-all/handler';
import { LogoutCommandHandler } from 'src/module/auth/application/command/logout/handler';
import { TOKEN_ADMIN_IDENTITY_READER_PORT } from 'src/module/auth/application/command/port/admin-identity-reader.port';
import { TOKEN_USER_IDENTITY_READER_PORT } from 'src/module/auth/application/command/port/user-identity-reader.port';
import { RefreshTokensCommandHandler } from 'src/module/auth/application/command/refresh-tokens/handler';
import { AdminIdentityReaderAdapter } from 'src/module/auth/infrastructure/adapter/admin-identity-reader.adapter';
import { UserIdentityReaderAdapter } from 'src/module/auth/infrastructure/adapter/user-identity-reader.adapter';
import { AuthController } from 'src/module/auth/presentation/controller/auth.controller';
import { UserModule } from 'src/module/user';

/**
 * The module responsible for configuring authentication services, controller routing, and dependencies.
 * It encapsulates the business logic for login, token refresh, and session management, exposing the `AuthService` for internal cross-module usage.
 */
@Module({
    imports: [
        AuditModule,
        EventBusModule,
        HashingModule,
        TokenModule,
        SessionModule,
        UserModule,
        AdminModule,
        CqrsModule,
    ],
    controllers: [AuthController],
    providers: [
        LoginAdminCommandHandler,
        LoginUserCommandHandler,
        LogoutCommandHandler,
        LogoutAllCommandHandler,
        RefreshTokensCommandHandler,
        {
            provide: TOKEN_USER_IDENTITY_READER_PORT,
            useClass: UserIdentityReaderAdapter,
        },
        {
            provide: TOKEN_ADMIN_IDENTITY_READER_PORT,
            useClass: AdminIdentityReaderAdapter,
        },
    ],
})
export class AuthModule {}
