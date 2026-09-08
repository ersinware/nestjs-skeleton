/**
 * @file admin.module.ts
 * @description NestJS wiring of the admin bounded context.
 */

import { Module } from '@nestjs/common';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { EmailModule } from 'src/core/email';
import { EventBusModule } from 'src/core/event-bus';
import { AuditModule } from 'src/core/observability/audit';
import { HashingModule } from 'src/core/security/hashing';
import { SessionModule } from 'src/core/security/session';
import { TokenModule } from 'src/core/security/token';
import { AdminFacade } from 'src/module/admin/admin.facade';
import { ActivateAdminCommandHandler } from 'src/module/admin/application/command/activate-admin/handler';
import { BanAdminCommandHandler } from 'src/module/admin/application/command/ban-admin/handler';
import { ChangeAdminPasswordCommandHandler } from 'src/module/admin/application/command/change-admin-password/handler';
import { ChangeAdminPermissionsCommandHandler } from 'src/module/admin/application/command/change-admin-permissions/handler';
import { CreateAdminCommandHandler } from 'src/module/admin/application/command/create-admin/handler';
import { DeleteAdminCommandHandler } from 'src/module/admin/application/command/delete-admin/handler';
import { TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port/admin-writer.port';
import { ReInviteAdminCommandHandler } from 'src/module/admin/application/command/re-invite-admin/handler';
import { ReconcileAdminSessionCommandHandler } from 'src/module/admin/application/command/reconcile-admin-session/handler';
import { RevokeAdminSessionsCommandHandler } from 'src/module/admin/application/command/revoke-admin-sessions/handler';
import { SendAdminInviteCommandHandler } from 'src/module/admin/application/command/send-admin-invite/handler';
import { UnbanAdminCommandHandler } from 'src/module/admin/application/command/unban-admin/handler';
import { UpdateAdminCommandHandler } from 'src/module/admin/application/command/update-admin/handler';
import { AdminInviteListener } from 'src/module/admin/application/event/admin-invite.listener';
import { AdminSessionRevocationListener } from 'src/module/admin/application/event/admin-session-revocation.listener';
import { AdminSessionListener } from 'src/module/admin/application/event/admin-session.listener';
import { GetAdminAuthStateQueryHandler } from 'src/module/admin/application/query/get-admin-auth-state/handler';
import { TOKEN_GET_ADMIN_AUTH_STATE_PORT } from 'src/module/admin/application/query/get-admin-auth-state/port';
import { GetAdminByIdQueryHandler } from 'src/module/admin/application/query/get-admin-by-id/handler';
import { TOKEN_GET_ADMIN_BY_ID_PORT } from 'src/module/admin/application/query/get-admin-by-id/port';
import { GetAdminCredentialsByEmailQueryHandler } from 'src/module/admin/application/query/get-admin-credentials-by-email/handler';
import { TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT } from 'src/module/admin/application/query/get-admin-credentials-by-email/port';
import { TOKEN_GET_ADMIN_SESSION_VERSION_PORT } from 'src/module/admin/application/query/get-admin-session-version/port';
import { ListAdminPermissionCatalogQueryHandler } from 'src/module/admin/application/query/list-admin-permission-catalog/handler';
import { ListAdminsQueryHandler } from 'src/module/admin/application/query/list-admins/handler';
import { TOKEN_LIST_ADMINS_PORT } from 'src/module/admin/application/query/list-admins/port';
import { AdminReaderAdapter } from 'src/module/admin/infrastructure/adapter/admin-reader.adapter';
import { AdminReplicaReaderAdapter } from 'src/module/admin/infrastructure/adapter/admin-replica-reader.adapter';
import { AdminWriterAdapter } from 'src/module/admin/infrastructure/adapter/admin-writer.adapter';
import { AdminController } from 'src/module/admin/presentation/controller/admin.controller';

/**
 * Wires the admin bounded context: binds every port token to its adapter, registers the handlers and
 * listeners, and exports only the facade — the sole surface other modules may consume.
 */
@Module({
    imports: [
        AuditModule,
        DatabaseModule,
        EventBusModule,
        HashingModule,
        SessionModule,
        TokenModule,
        EmailModule,
        CqrsPipelineModule,
    ],
    controllers: [AdminController],
    providers: [
        AdminFacade,
        CreateAdminCommandHandler,
        SendAdminInviteCommandHandler,
        ActivateAdminCommandHandler,
        ReInviteAdminCommandHandler,
        UpdateAdminCommandHandler,
        ChangeAdminPasswordCommandHandler,
        DeleteAdminCommandHandler,
        BanAdminCommandHandler,
        UnbanAdminCommandHandler,
        ChangeAdminPermissionsCommandHandler,
        RevokeAdminSessionsCommandHandler,
        ReconcileAdminSessionCommandHandler,
        ListAdminsQueryHandler,
        ListAdminPermissionCatalogQueryHandler,
        GetAdminByIdQueryHandler,
        GetAdminCredentialsByEmailQueryHandler,
        GetAdminAuthStateQueryHandler,
        AdminSessionRevocationListener,
        AdminSessionListener,
        AdminInviteListener,
        { provide: TOKEN_ADMIN_WRITER_PORT, useClass: AdminWriterAdapter },
        { provide: TOKEN_GET_ADMIN_AUTH_STATE_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_BY_ID_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_SESSION_VERSION_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_LIST_ADMINS_PORT, useClass: AdminReplicaReaderAdapter },
    ],
    exports: [AdminFacade],
})
export class AdminModule {}
