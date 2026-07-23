/**
 * @file admin.module.ts
 * @description Configures the administrative domain of the application. It bundles the controllers, services, and repositories required for managing admin accounts and provides these capabilities to the rest of the application context.
 */

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from 'src/core/database';
import { EmailModule } from 'src/core/email';
import { EventBusModule } from 'src/core/event-bus';
import { AuditModule } from 'src/core/observability/audit';
import { HashingModule } from 'src/core/security/hashing';
import { SessionModule } from 'src/core/security/session';
import { AdminFacade } from 'src/module/admin/admin.facade';
import { BanAdminCommandHandler } from 'src/module/admin/application/command/ban-admin/handler';
import { CreateAdminCommandHandler } from 'src/module/admin/application/command/create-admin/handler';
import { DeleteAdminCommandHandler } from 'src/module/admin/application/command/delete-admin/handler';
import { TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port/admin-writer.port';
import { RevokeAdminSessionsCommandHandler } from 'src/module/admin/application/command/revoke-admin-sessions/handler';
import { UnbanAdminCommandHandler } from 'src/module/admin/application/command/unban-admin/handler';
import { AdminEmailListener } from 'src/module/admin/application/event/admin-email.listener';
import { AdminReuseListener } from 'src/module/admin/application/event/admin-reuse.listener';
import { AdminSessionListener } from 'src/module/admin/application/event/admin-session.listener';
import { TOKEN_GET_ADMIN_ACCESS_PROJECTION_PORT } from 'src/module/admin/application/query/get-admin-access-projection/port';
import { GetAdminAuthStateQueryHandler } from 'src/module/admin/application/query/get-admin-auth-state/handler';
import { TOKEN_GET_ADMIN_AUTH_STATE_PORT } from 'src/module/admin/application/query/get-admin-auth-state/port';
import { GetAdminCredentialsByEmailQueryHandler } from 'src/module/admin/application/query/get-admin-credentials-by-email/handler';
import { TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT } from 'src/module/admin/application/query/get-admin-credentials-by-email/port';
import { TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT } from 'src/module/admin/application/query/get-admin-email-and-name/port';
import { ListAdminsQueryHandler } from 'src/module/admin/application/query/list-admins/handler';
import { TOKEN_LIST_ADMINS_PORT } from 'src/module/admin/application/query/list-admins/port';
import { AdminReaderAdapter } from 'src/module/admin/infrastructure/adapter/admin-reader.adapter';
import { AdminWriterAdapter } from 'src/module/admin/infrastructure/adapter/admin-writer.adapter';
import { AdminController } from 'src/module/admin/presentation/controller/admin.controller';

/**
 * The module responsible for orchestrating admin-related database operations and registering dependencies.
 * Registers both the write repository (aggregate-based) and the read/query repository (projection-based),
 * and exposes the AdminFacade for cross-domain usage.
 */
@Module({
    imports: [AuditModule, DatabaseModule, EventBusModule, HashingModule, SessionModule, EmailModule, CqrsModule],
    controllers: [AdminController],
    providers: [
        AdminFacade,
        CreateAdminCommandHandler,
        DeleteAdminCommandHandler,
        BanAdminCommandHandler,
        UnbanAdminCommandHandler,
        RevokeAdminSessionsCommandHandler,
        ListAdminsQueryHandler,
        GetAdminCredentialsByEmailQueryHandler,
        GetAdminAuthStateQueryHandler,
        AdminEmailListener,
        AdminReuseListener,
        AdminSessionListener,
        { provide: TOKEN_ADMIN_WRITER_PORT, useClass: AdminWriterAdapter },
        { provide: TOKEN_GET_ADMIN_AUTH_STATE_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_ACCESS_PROJECTION_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_LIST_ADMINS_PORT, useClass: AdminReaderAdapter },
    ],
    exports: [AdminFacade],
})
export class AdminModule {}
