/**
 * @file user.module.ts
 * @description NestJS wiring of the user bounded context.
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CacheModule } from 'src/core/cache';
import { ENV } from 'src/core/config';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { EmailModule } from 'src/core/email';
import { IdempotencyModule } from 'src/core/idempotency';
import { JobQueueModule } from 'src/core/job-queue';
import { AuditModule } from 'src/core/observability/audit';
import { ErrorReporterModule } from 'src/core/observability/error-reporter';
import { EmailChangeModule } from 'src/core/security/email-change';
import { HashingModule } from 'src/core/security/hashing';
import { SessionModule } from 'src/core/security/session';
import { JwtTokenAdapter, TokenModule, type ITokenPort } from 'src/core/security/token';
import { StorageModule } from 'src/core/storage';
import { ActivateUserCommandHandler } from 'src/module/user/application/command/activate-user/handler';
import { BanUserCommandHandler } from 'src/module/user/application/command/ban-user/handler';
import { ChangeUserPasswordCommandHandler } from 'src/module/user/application/command/change-user-password/handler';
import { ConfirmUserEmailChangeCommandHandler } from 'src/module/user/application/command/confirm-user-email-change/handler';
import { DeleteUserCommandHandler } from 'src/module/user/application/command/delete-user/handler';
import { FinalizeUserAvatarCommandHandler } from 'src/module/user/application/command/finalize-user-avatar/handler';
import { InitiateUserAvatarChangeCommandHandler } from 'src/module/user/application/command/initiate-user-avatar-change/handler';
import { InitiateUserEmailChangeCommandHandler } from 'src/module/user/application/command/initiate-user-email-change/handler';
import { InitiateUserRegistrationCommandHandler } from 'src/module/user/application/command/initiate-user-registration/handler';
import { TOKEN_USER_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT } from 'src/module/user/application/command/port/user-email-change-notification-writer.port';
import { TOKEN_USER_WRITER_PORT } from 'src/module/user/application/command/port/user-writer.port';
import { ReconcileUserSessionCommandHandler } from 'src/module/user/application/command/reconcile-user-session/handler';
import { RegisterUserCommandHandler } from 'src/module/user/application/command/register-user/handler';
import { ReplaceUserAvatarCommandHandler } from 'src/module/user/application/command/replace-user-avatar/handler';
import { ReplaceUserPermissionsCommandHandler } from 'src/module/user/application/command/replace-user-permissions/handler';
import { ResendUserActivationCommandHandler } from 'src/module/user/application/command/resend-user-activation/handler';
import { RevokeUserSessionsCommandHandler } from 'src/module/user/application/command/revoke-user-sessions/handler';
import { SendUserActivationCommandHandler } from 'src/module/user/application/command/send-user-activation/handler';
import { SendUserEmailChangeNotificationCommandHandler } from 'src/module/user/application/command/send-user-email-change-notification/handler';
import { SendUserEmailConfirmationCommandHandler } from 'src/module/user/application/command/send-user-email-confirmation/handler';
import { SendUserRefreshReuseNoticeCommandHandler } from 'src/module/user/application/command/send-user-refresh-reuse-notice/handler';
import { UnbanUserCommandHandler } from 'src/module/user/application/command/unban-user/handler';
import { UpdateUserCommandHandler } from 'src/module/user/application/command/update-user/handler';
import { UserActivationConsumer } from 'src/module/user/application/consumer/user-activation.consumer';
import { UserAvatarFinalizeConsumer } from 'src/module/user/application/consumer/user-avatar-finalize.consumer';
import { UserAvatarReplaceConsumer } from 'src/module/user/application/consumer/user-avatar-replace.consumer';
import { UserCacheConsumer } from 'src/module/user/application/consumer/user-cache.consumer';
import { UserEmailChangeNotificationConsumer } from 'src/module/user/application/consumer/user-email-change-notification.consumer';
import { UserEmailConfirmationConsumer } from 'src/module/user/application/consumer/user-email-confirmation.consumer';
import { UserRefreshReuseNoticeConsumer } from 'src/module/user/application/consumer/user-refresh-reuse-notice.consumer';
import { UserSessionRevocationLogoutAllConsumer } from 'src/module/user/application/consumer/user-session-revocation-logout-all.consumer';
import { UserSessionRevocationRefreshReuseConsumer } from 'src/module/user/application/consumer/user-session-revocation-refresh-reuse.consumer';
import { UserSessionConsumer } from 'src/module/user/application/consumer/user-session.consumer';
import { GetFreshUserByIdQueryHandler } from 'src/module/user/application/query/get-fresh-user-by-id/handler';
import { TOKEN_GET_FRESH_USER_BY_ID_PORT } from 'src/module/user/application/query/get-fresh-user-by-id/port';
import { TOKEN_GET_USER_ACTIVATION_RECIPIENT_PORT } from 'src/module/user/application/query/get-user-activation-recipient/port';
import { GetUserByIdQueryHandler } from 'src/module/user/application/query/get-user-by-id/handler';
import { TOKEN_GET_USER_BY_ID_PORT } from 'src/module/user/application/query/get-user-by-id/port';
import { GetUserCredentialsByEmailQueryHandler } from 'src/module/user/application/query/get-user-credentials-by-email/handler';
import { TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT } from 'src/module/user/application/query/get-user-credentials-by-email/port';
import { TOKEN_GET_USER_EMAIL_CHANGE_NOTIFICATION_RECIPIENT_PORT } from 'src/module/user/application/query/get-user-email-change-notification-recipient/port';
import { TOKEN_GET_USER_EMAIL_CONFIRMATION_RECIPIENT_PORT } from 'src/module/user/application/query/get-user-email-confirmation-recipient/port';
import { GetUserRefreshStateQueryHandler } from 'src/module/user/application/query/get-user-refresh-state/handler';
import { TOKEN_GET_USER_REFRESH_STATE_PORT } from 'src/module/user/application/query/get-user-refresh-state/port';
import { TOKEN_GET_USER_SESSION_VERSION_PORT } from 'src/module/user/application/query/get-user-session-version/port';
import { TOKEN_IS_USER_EMAIL_IN_USE_PORT } from 'src/module/user/application/query/is-user-email-in-use/port';
import { ListUserPermissionCatalogQueryHandler } from 'src/module/user/application/query/list-user-permission-catalog/handler';
import { ListUsersQueryHandler } from 'src/module/user/application/query/list-users/handler';
import { TOKEN_LIST_USERS_PORT } from 'src/module/user/application/query/list-users/port';
import {
    TOKEN_USER_ACTIVATION_TOKEN_PORT,
    USER_ACTIVATION_TOKEN_TYPE,
} from 'src/module/user/application/user-activation-token';
import { UserEmailChangeNotificationWriterAdapter } from 'src/module/user/infrastructure/adapter/user-email-change-notification-writer.adapter';
import { UserReaderAdapter } from 'src/module/user/infrastructure/adapter/user-reader.adapter';
import { UserReplicaReaderAdapter } from 'src/module/user/infrastructure/adapter/user-replica-reader.adapter';
import { UserWriterAdapter } from 'src/module/user/infrastructure/adapter/user-writer.adapter';
import { UserController } from 'src/module/user/presentation/controller/user.controller';
import { UserFacade } from 'src/module/user/user.facade';

/**
 * Wires the user bounded context: binds every port token to its adapter, registers handlers and job
 * consumers, and exports only the facade — the sole surface other modules may consume.
 */
@Module({
    imports: [
        AuditModule,
        ErrorReporterModule,
        DatabaseModule,
        IdempotencyModule,
        CacheModule,
        JobQueueModule,
        HashingModule,
        SessionModule,
        TokenModule,
        EmailChangeModule,
        StorageModule,
        EmailModule,
        CqrsPipelineModule,
        JobQueueModule.forFeature(
            [
                UserActivationConsumer,
                UserAvatarFinalizeConsumer,
                UserAvatarReplaceConsumer,
                UserEmailConfirmationConsumer,
                UserEmailChangeNotificationConsumer,
                UserCacheConsumer,
                UserRefreshReuseNoticeConsumer,
                UserSessionConsumer,
                UserSessionRevocationLogoutAllConsumer,
                UserSessionRevocationRefreshReuseConsumer,
            ],
            [CacheModule, CqrsPipelineModule],
        ),
    ],
    controllers: [UserController],
    providers: [
        UserFacade,
        ActivateUserCommandHandler,
        RegisterUserCommandHandler,
        InitiateUserRegistrationCommandHandler,
        FinalizeUserAvatarCommandHandler,
        InitiateUserAvatarChangeCommandHandler,
        ReplaceUserAvatarCommandHandler,
        ResendUserActivationCommandHandler,
        SendUserActivationCommandHandler,
        UpdateUserCommandHandler,
        ChangeUserPasswordCommandHandler,
        ConfirmUserEmailChangeCommandHandler,
        InitiateUserEmailChangeCommandHandler,
        SendUserEmailConfirmationCommandHandler,
        SendUserEmailChangeNotificationCommandHandler,
        DeleteUserCommandHandler,
        BanUserCommandHandler,
        UnbanUserCommandHandler,
        ReplaceUserPermissionsCommandHandler,
        RevokeUserSessionsCommandHandler,
        SendUserRefreshReuseNoticeCommandHandler,
        ReconcileUserSessionCommandHandler,
        ListUsersQueryHandler,
        ListUserPermissionCatalogQueryHandler,
        GetUserByIdQueryHandler,
        GetFreshUserByIdQueryHandler,
        GetUserCredentialsByEmailQueryHandler,
        GetUserRefreshStateQueryHandler,
        { provide: TOKEN_USER_WRITER_PORT, useClass: UserWriterAdapter },
        {
            provide: TOKEN_USER_EMAIL_CHANGE_NOTIFICATION_WRITER_PORT,
            useClass: UserEmailChangeNotificationWriterAdapter,
        },
        { provide: TOKEN_GET_USER_REFRESH_STATE_PORT, useClass: UserReaderAdapter },
        { provide: TOKEN_GET_USER_ACTIVATION_RECIPIENT_PORT, useExisting: TOKEN_GET_USER_REFRESH_STATE_PORT },
        { provide: TOKEN_IS_USER_EMAIL_IN_USE_PORT, useExisting: TOKEN_GET_USER_REFRESH_STATE_PORT },
        { provide: TOKEN_GET_USER_EMAIL_CONFIRMATION_RECIPIENT_PORT, useExisting: TOKEN_GET_USER_REFRESH_STATE_PORT },
        {
            provide: TOKEN_GET_USER_EMAIL_CHANGE_NOTIFICATION_RECIPIENT_PORT,
            useExisting: TOKEN_GET_USER_REFRESH_STATE_PORT,
        },
        { provide: TOKEN_GET_FRESH_USER_BY_ID_PORT, useExisting: TOKEN_GET_USER_REFRESH_STATE_PORT },
        { provide: TOKEN_GET_USER_SESSION_VERSION_PORT, useExisting: TOKEN_GET_USER_REFRESH_STATE_PORT },
        { provide: TOKEN_GET_USER_BY_ID_PORT, useExisting: TOKEN_GET_USER_REFRESH_STATE_PORT },
        { provide: TOKEN_GET_USER_CREDENTIALS_BY_EMAIL_PORT, useExisting: TOKEN_GET_USER_REFRESH_STATE_PORT },
        { provide: TOKEN_LIST_USERS_PORT, useClass: UserReplicaReaderAdapter },
        {
            provide: TOKEN_USER_ACTIVATION_TOKEN_PORT,
            inject: [JwtService, ConfigService],
            useFactory: (
                jwtService: JwtService,
                configService: ConfigService,
            ): ITokenPort<typeof USER_ACTIVATION_TOKEN_TYPE> =>
                new JwtTokenAdapter(jwtService, configService.getOrThrow<string>(ENV.JWT_ACTIVATION_SECRET)),
        },
    ],
    exports: [UserFacade],
})
export class UserModule {}
