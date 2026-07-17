/**
 * @file admin.module.ts
 * @description Configures the administrative domain of the application. It bundles the controllers, services, and repositories required for managing admin accounts and provides these capabilities to the rest of the application context.
 */

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { EmailModule } from 'src/core/email/module';
import { HashingModule, SessionModule } from 'src/core/security';
import { AdminFacade } from 'src/module/admin/admin.facade';
import { BanAdminCommandHandler } from 'src/module/admin/application/command/ban-admin';
import { CreateAdminCommandHandler } from 'src/module/admin/application/command/create-admin';
import { DeleteAdminCommandHandler } from 'src/module/admin/application/command/delete-admin';
import { TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port';
import { RevokeAdminSessionsCommandHandler } from 'src/module/admin/application/command/revoke-admin-sessions';
import { UnbanAdminCommandHandler } from 'src/module/admin/application/command/unban-admin';
import { AdminEmailListener, AdminReuseListener, AdminSessionListener } from 'src/module/admin/application/event';
import { TOKEN_GET_ADMIN_ACCESS_PROJECTION_PORT } from 'src/module/admin/application/query/get-admin-access-projection';
import {
    GetAdminAuthStateQueryHandler,
    TOKEN_GET_ADMIN_AUTH_STATE_PORT,
} from 'src/module/admin/application/query/get-admin-auth-state';
import {
    GetAdminCredentialsByEmailQueryHandler,
    TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT,
} from 'src/module/admin/application/query/get-admin-credentials-by-email';
import { TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT } from 'src/module/admin/application/query/get-admin-email-and-name';
import { ListAdminsQueryHandler, TOKEN_LIST_ADMINS_PORT } from 'src/module/admin/application/query/list-admins';
import { AdminReaderAdapter, AdminWriterAdapter } from 'src/module/admin/infrastructure/adapter';
import { AdminController } from 'src/module/admin/presentation/controller/admin.controller';

/**
 * The module responsible for orchestrating admin-related database operations and registering dependencies.
 * Registers both the write repository (aggregate-based) and the read/query repository (projection-based),
 * and exposes the AdminFacade for cross-domain usage.
 */
@Module({
    imports: [HashingModule, SessionModule, EmailModule, CqrsModule],
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
