/**
 * @file admin.module.ts
 * @description Configures the administrative domain of the application. It bundles the controllers, services, and repositories required for managing admin accounts and provides these capabilities to the rest of the application context.
 */

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { EmailModule } from 'src/core/email/module';
import { HashingModule, SessionModule } from 'src/core/security';
import { AdminFacade } from 'src/module/admin/admin.facade';
import { CreateAdminCommandHandler } from 'src/module/admin/application/command/create-admin';
import { DeleteAdminCommandHandler } from 'src/module/admin/application/command/delete-admin';
import { TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port';
import { UpdateAdminStatusCommandHandler } from 'src/module/admin/application/command/update-admin-status';
import { AdminEmailListener, AdminSessionListener } from 'src/module/admin/application/event';
import {
    CheckAdminIsActiveQueryHandler,
    TOKEN_CHECK_ADMIN_IS_ACTIVE_PORT,
} from 'src/module/admin/application/query/check-admin-is-active';
import {
    GetAdminByIdQueryHandler,
    TOKEN_GET_ADMIN_BY_ID_PORT,
} from 'src/module/admin/application/query/get-admin-by-id';
import {
    GetAdminCredentialsByEmailQueryHandler,
    TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT,
} from 'src/module/admin/application/query/get-admin-credentials-by-email';
import {
    GetAdminCredentialsByIdQueryHandler,
    TOKEN_GET_ADMIN_CREDENTIALS_BY_ID_PORT,
} from 'src/module/admin/application/query/get-admin-credentials-by-id';
import {
    GetAdminEmailAndNameQueryHandler,
    TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT,
} from 'src/module/admin/application/query/get-admin-email-and-name';
import { GetAdminRoleQueryHandler, TOKEN_GET_ADMIN_ROLE_PORT } from 'src/module/admin/application/query/get-admin-role';
import {
    GetDeletedAdminRoleQueryHandler,
    TOKEN_GET_DELETED_ADMIN_ROLE_PORT,
} from 'src/module/admin/application/query/get-deleted-admin-role';
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
        UpdateAdminStatusCommandHandler,
        ListAdminsQueryHandler,
        GetAdminCredentialsByEmailQueryHandler,
        GetAdminByIdQueryHandler,
        GetAdminCredentialsByIdQueryHandler,
        CheckAdminIsActiveQueryHandler,
        GetAdminRoleQueryHandler,
        GetAdminEmailAndNameQueryHandler,
        GetDeletedAdminRoleQueryHandler,
        AdminEmailListener,
        AdminSessionListener,
        { provide: TOKEN_ADMIN_WRITER_PORT, useClass: AdminWriterAdapter },
        { provide: TOKEN_CHECK_ADMIN_IS_ACTIVE_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_BY_ID_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_CREDENTIALS_BY_ID_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_EMAIL_AND_NAME_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_ROLE_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_DELETED_ADMIN_ROLE_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_LIST_ADMINS_PORT, useClass: AdminReaderAdapter },
    ],
    exports: [AdminFacade],
})
export class AdminModule {}
