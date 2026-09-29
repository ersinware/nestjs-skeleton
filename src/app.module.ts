/**
 * @file app.module.ts
 * @description Application dependency and global provider composition.
 */

import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { CacheModule } from 'src/core/cache';
import { resolveEnvFilePath, validateConfig } from 'src/core/config';
import { DatabaseModule } from 'src/core/database';
import { EmailModule } from 'src/core/email';
import { GlobalExceptionFilter } from 'src/core/exception';
import { HttpCacheInterceptor, NotEmptyBodyPipe, ResponseInterceptor } from 'src/core/http';
import { AuditInterceptor, AuditModule } from 'src/core/observability/audit';
import { ErrorReporterModule } from 'src/core/observability/error-reporter';
import { LoggerModule } from 'src/core/observability/logger';
import { AuthenticationGuard, AuthorizationGuard, AuthPolicyModule } from 'src/core/security/auth';
import { SessionModule } from 'src/core/security/session';
import { TokenModule } from 'src/core/security/token';
import { StorageModule } from 'src/core/storage';
import { AdminModule } from 'src/module/admin';
import { AuditTrailModule } from 'src/module/audit-trail';
import { AuthModule } from 'src/module/auth';
import { HealthModule } from 'src/module/health';
import { JobQueueOperationsModule } from 'src/module/job-queue-operations';
import { UserModule } from 'src/module/user';

/**
 * Composition root of the application's dependency tree.
 */
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: resolveEnvFilePath(),
            validate: validateConfig,
        }),
        LoggerModule,
        AuditModule,
        ErrorReporterModule,
        CacheModule,
        DatabaseModule,
        EmailModule,
        TokenModule,
        StorageModule,
        SessionModule,
        AuthPolicyModule,
        HealthModule,
        AuthModule,
        UserModule,
        AdminModule,
        AuditTrailModule,
        JobQueueOperationsModule,
    ],
    providers: [
        {
            provide: APP_GUARD,
            useClass: AuthenticationGuard,
        },
        {
            provide: APP_GUARD,
            useClass: AuthorizationGuard,
        },
        {
            provide: APP_PIPE,
            useClass: NotEmptyBodyPipe,
        },
        {
            provide: APP_PIPE,
            useValue: new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                forbidUnknownValues: true,
                validationError: {
                    target: false,
                    value: false,
                },
                transform: true,
            }),
        },
        // Check cache policy before other interceptors or the handler run.
        {
            provide: APP_INTERCEPTOR,
            useClass: HttpCacheInterceptor,
        },
        // Audit context and verified identity are available before interceptors run.
        {
            provide: APP_INTERCEPTOR,
            useClass: AuditInterceptor,
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: ResponseInterceptor,
        },
        {
            provide: APP_FILTER,
            useClass: GlobalExceptionFilter,
        },
    ],
})
export class AppModule {}
