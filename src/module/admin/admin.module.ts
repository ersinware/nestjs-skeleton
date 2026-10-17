/**
 * @file admin.module.ts
 * @description Wires the admin bounded context.
 */

import { Module } from '@nestjs/common';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { EmailModule } from 'src/core/email';
import { JobQueueModule } from 'src/core/job-queue';
import { AuditModule } from 'src/core/observability/audit';
import { ErrorReporterModule } from 'src/core/observability/error-reporter';
import { HashingModule } from 'src/core/security/hashing';
import { SessionModule } from 'src/core/security/session';
import { TokenModule } from 'src/core/security/token';
import { StorageModule } from 'src/core/storage';
import { AdminFacade } from 'src/module/admin/admin.facade';
import { ActivateAdminCommandHandler } from 'src/module/admin/application/command/activate-admin/handler';
import { BanAdminCommandHandler } from 'src/module/admin/application/command/ban-admin/handler';
import { ChangeAdminPasswordCommandHandler } from 'src/module/admin/application/command/change-admin-password/handler';
import { ConfirmAdminEmailChangeCommandHandler } from 'src/module/admin/application/command/confirm-admin-email-change/handler';
import { DeleteAdminCommandHandler } from 'src/module/admin/application/command/delete-admin/handler';
import { FinalizeAdminAvatarCommandHandler } from 'src/module/admin/application/command/finalize-admin-avatar/handler';
import { InitiateAdminActivationCommandHandler } from 'src/module/admin/application/command/initiate-admin-activation/handler';
import { InitiateAdminAvatarChangeCommandHandler } from 'src/module/admin/application/command/initiate-admin-avatar-change/handler';
import { InitiateAdminEmailChangeCommandHandler } from 'src/module/admin/application/command/initiate-admin-email-change/handler';
import { InviteAdminCommandHandler } from 'src/module/admin/application/command/invite-admin/handler';
import { TOKEN_ADMIN_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT } from 'src/module/admin/application/command/port/admin-email-change-notification-writer.port';
import { TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port/admin-writer.port';
import { ReInviteAdminCommandHandler } from 'src/module/admin/application/command/re-invite-admin/handler';
import { ReconcileAdminSessionCommandHandler } from 'src/module/admin/application/command/reconcile-admin-session/handler';
import { ReplaceAdminAvatarCommandHandler } from 'src/module/admin/application/command/replace-admin-avatar/handler';
import { ReplaceAdminPermissionsCommandHandler } from 'src/module/admin/application/command/replace-admin-permissions/handler';
import { RevokeAdminSessionsCommandHandler } from 'src/module/admin/application/command/revoke-admin-sessions/handler';
import { SendAdminEmailChangeNotificationCommandHandler } from 'src/module/admin/application/command/send-admin-email-change-notification/handler';
import { SendAdminEmailConfirmationCommandHandler } from 'src/module/admin/application/command/send-admin-email-confirmation/handler';
import { SendAdminInviteCommandHandler } from 'src/module/admin/application/command/send-admin-invite/handler';
import { SendAdminRefreshReuseNoticeCommandHandler } from 'src/module/admin/application/command/send-admin-refresh-reuse-notice/handler';
import { UnbanAdminCommandHandler } from 'src/module/admin/application/command/unban-admin/handler';
import { UpdateAdminCommandHandler } from 'src/module/admin/application/command/update-admin/handler';
import { GetAdminByIdQueryHandler } from 'src/module/admin/application/query/get-admin-by-id/handler';
import { TOKEN_GET_ADMIN_BY_ID_PORT } from 'src/module/admin/application/query/get-admin-by-id/port';
import { GetAdminCredentialsByEmailQueryHandler } from 'src/module/admin/application/query/get-admin-credentials-by-email/handler';
import { TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT } from 'src/module/admin/application/query/get-admin-credentials-by-email/port';
import { TOKEN_GET_ADMIN_EMAIL_CHANGE_NOTIFICATION_RECIPIENT_PORT } from 'src/module/admin/application/query/get-admin-email-change-notification-recipient/port';
import { TOKEN_GET_ADMIN_EMAIL_CONFIRMATION_RECIPIENT_PORT } from 'src/module/admin/application/query/get-admin-email-confirmation-recipient/port';
import { TOKEN_GET_ADMIN_INVITE_RECIPIENT_PORT } from 'src/module/admin/application/query/get-admin-invite-recipient/port';
import { TOKEN_GET_ADMIN_NOTICE_RECIPIENT_PORT } from 'src/module/admin/application/query/get-admin-notice-recipient/port';
import { GetAdminRefreshStateQueryHandler } from 'src/module/admin/application/query/get-admin-refresh-state/handler';
import { TOKEN_GET_ADMIN_REFRESH_STATE_PORT } from 'src/module/admin/application/query/get-admin-refresh-state/port';
import { TOKEN_GET_ADMIN_SESSION_VERSION_PORT } from 'src/module/admin/application/query/get-admin-session-version/port';
import { GetFreshAdminByIdQueryHandler } from 'src/module/admin/application/query/get-fresh-admin-by-id/handler';
import { TOKEN_GET_FRESH_ADMIN_BY_ID_PORT } from 'src/module/admin/application/query/get-fresh-admin-by-id/port';
import { TOKEN_IS_ADMIN_EMAIL_IN_USE_PORT } from 'src/module/admin/application/query/is-admin-email-in-use/port';
import { ListAdminPermissionCatalogQueryHandler } from 'src/module/admin/application/query/list-admin-permission-catalog/handler';
import { ListAdminsQueryHandler } from 'src/module/admin/application/query/list-admins/handler';
import { TOKEN_LIST_ADMINS_PORT } from 'src/module/admin/application/query/list-admins/port';
import { AdminAvatarFinalizeQueue } from 'src/module/admin/application/queue/admin-avatar-finalize.queue';
import { AdminAvatarReplaceQueue } from 'src/module/admin/application/queue/admin-avatar-replace.queue';
import { AdminEmailChangeNotificationQueue } from 'src/module/admin/application/queue/admin-email-change-notification.queue';
import { AdminEmailConfirmationQueue } from 'src/module/admin/application/queue/admin-email-confirmation.queue';
import { AdminInviteQueue } from 'src/module/admin/application/queue/admin-invite.queue';
import { AdminRefreshReuseNoticeQueue } from 'src/module/admin/application/queue/admin-refresh-reuse-notice.queue';
import { AdminSessionRevocationLogoutAllQueue } from 'src/module/admin/application/queue/admin-session-revocation-logout-all.queue';
import { AdminSessionRevocationRefreshReuseQueue } from 'src/module/admin/application/queue/admin-session-revocation-refresh-reuse.queue';
import { AdminSessionQueue } from 'src/module/admin/application/queue/admin-session.queue';
import { AdminEmailChangeNotificationWriterAdapter } from 'src/module/admin/infrastructure/adapter/admin-email-change-notification-writer.adapter';
import { AdminReaderAdapter } from 'src/module/admin/infrastructure/adapter/admin-reader.adapter';
import { AdminReplicaReaderAdapter } from 'src/module/admin/infrastructure/adapter/admin-replica-reader.adapter';
import { AdminWriterAdapter } from 'src/module/admin/infrastructure/adapter/admin-writer.adapter';
import { AdminController } from 'src/module/admin/presentation/controller/admin.controller';

/**
 * Wires the admin context and exposes its facade.
 */
@Module({
    imports: [
        AuditModule,
        ErrorReporterModule,
        DatabaseModule,
        JobQueueModule,
        HashingModule,
        SessionModule,
        TokenModule,
        StorageModule,
        EmailModule,
        CqrsPipelineModule,
        JobQueueModule.forFeature(
            [
                AdminEmailConfirmationQueue,
                AdminEmailChangeNotificationQueue,
                AdminInviteQueue,
                AdminAvatarFinalizeQueue,
                AdminAvatarReplaceQueue,
                AdminRefreshReuseNoticeQueue,
                AdminSessionQueue,
                AdminSessionRevocationLogoutAllQueue,
                AdminSessionRevocationRefreshReuseQueue,
            ],
            [CqrsPipelineModule],
        ),
    ],
    controllers: [AdminController],
    providers: [
        AdminFacade,
        InviteAdminCommandHandler,
        SendAdminInviteCommandHandler,
        SendAdminRefreshReuseNoticeCommandHandler,
        ActivateAdminCommandHandler,
        InitiateAdminActivationCommandHandler,
        InitiateAdminAvatarChangeCommandHandler,
        FinalizeAdminAvatarCommandHandler,
        ReInviteAdminCommandHandler,
        UpdateAdminCommandHandler,
        ReplaceAdminAvatarCommandHandler,
        ChangeAdminPasswordCommandHandler,
        ConfirmAdminEmailChangeCommandHandler,
        InitiateAdminEmailChangeCommandHandler,
        SendAdminEmailConfirmationCommandHandler,
        SendAdminEmailChangeNotificationCommandHandler,
        DeleteAdminCommandHandler,
        BanAdminCommandHandler,
        UnbanAdminCommandHandler,
        ReplaceAdminPermissionsCommandHandler,
        RevokeAdminSessionsCommandHandler,
        ReconcileAdminSessionCommandHandler,
        ListAdminsQueryHandler,
        ListAdminPermissionCatalogQueryHandler,
        GetAdminByIdQueryHandler,
        GetFreshAdminByIdQueryHandler,
        GetAdminCredentialsByEmailQueryHandler,
        GetAdminRefreshStateQueryHandler,
        { provide: TOKEN_ADMIN_WRITER_PORT, useClass: AdminWriterAdapter },
        {
            provide: TOKEN_ADMIN_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT,
            useClass: AdminEmailChangeNotificationWriterAdapter,
        },
        { provide: TOKEN_GET_ADMIN_REFRESH_STATE_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_IS_ADMIN_EMAIL_IN_USE_PORT, useExisting: TOKEN_GET_ADMIN_REFRESH_STATE_PORT },
        { provide: TOKEN_GET_ADMIN_EMAIL_CONFIRMATION_RECIPIENT_PORT, useExisting: TOKEN_GET_ADMIN_REFRESH_STATE_PORT },
        {
            provide: TOKEN_GET_ADMIN_EMAIL_CHANGE_NOTIFICATION_RECIPIENT_PORT,
            useExisting: TOKEN_GET_ADMIN_REFRESH_STATE_PORT,
        },
        { provide: TOKEN_GET_FRESH_ADMIN_BY_ID_PORT, useExisting: TOKEN_GET_ADMIN_REFRESH_STATE_PORT },
        { provide: TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT, useExisting: TOKEN_GET_ADMIN_REFRESH_STATE_PORT },
        { provide: TOKEN_GET_ADMIN_INVITE_RECIPIENT_PORT, useExisting: TOKEN_GET_ADMIN_REFRESH_STATE_PORT },
        { provide: TOKEN_GET_ADMIN_NOTICE_RECIPIENT_PORT, useExisting: TOKEN_GET_ADMIN_REFRESH_STATE_PORT },
        { provide: TOKEN_GET_ADMIN_SESSION_VERSION_PORT, useExisting: TOKEN_GET_ADMIN_REFRESH_STATE_PORT },
        { provide: TOKEN_LIST_ADMINS_PORT, useClass: AdminReplicaReaderAdapter },
        { provide: TOKEN_GET_ADMIN_BY_ID_PORT, useExisting: TOKEN_LIST_ADMINS_PORT },
    ],
    exports: [AdminFacade],
})
export class AdminModule {}
