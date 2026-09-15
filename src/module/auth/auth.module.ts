/**
 * @file auth.module.ts
 * @description Wires the auth bounded context: session lifecycle use cases, the identity-reader binding, and the controller.
 */

import { Module } from '@nestjs/common';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { AuditModule } from 'src/core/observability/audit';
import { ErrorReporterModule } from 'src/core/observability/error-reporter';
import { OutboxModule } from 'src/core/outbox';
import { HashingModule } from 'src/core/security/hashing';
import { SessionModule } from 'src/core/security/session';
import { TokenModule } from 'src/core/security/token';
import { AdminModule } from 'src/module/admin';
import { LoginAdminCommandHandler } from 'src/module/auth/application/command/login-admin/handler';
import { LoginUserCommandHandler } from 'src/module/auth/application/command/login-user/handler';
import { LogoutAllCommandHandler } from 'src/module/auth/application/command/logout-all/handler';
import { LogoutCommandHandler } from 'src/module/auth/application/command/logout/handler';
import { TOKEN_IDENTITY_READER_PORT } from 'src/module/auth/application/command/port/identity-reader.port';
import { RefreshTokensCommandHandler } from 'src/module/auth/application/command/refresh-tokens/handler';
import { IdentityReaderAdapter } from 'src/module/auth/infrastructure/adapter/identity-reader.adapter';
import { AuthController } from 'src/module/auth/presentation/controller/auth.controller';
import { UserModule } from 'src/module/user';

/**
 * The auth bounded context: login, token refresh, and logout use cases, with the identity-reader
 * adapter routing credential reads into the user and admin contexts.
 */
@Module({
    imports: [
        AuditModule,
        ErrorReporterModule,
        DatabaseModule,
        OutboxModule,
        HashingModule,
        TokenModule,
        SessionModule,
        UserModule,
        AdminModule,
        CqrsPipelineModule,
    ],
    controllers: [AuthController],
    providers: [
        {
            provide: TOKEN_IDENTITY_READER_PORT,
            useClass: IdentityReaderAdapter,
        },
        LoginAdminCommandHandler,
        LoginUserCommandHandler,
        LogoutCommandHandler,
        LogoutAllCommandHandler,
        RefreshTokensCommandHandler,
    ],
})
export class AuthModule {}
