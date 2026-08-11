/**
 * @file app.module.ts
 * @description Root module: aggregates every core concern and bounded context, and binds the global guards, pipes, interceptors, and exception filter.
 */

import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from 'src/core/cache';
import { resolveEnvFilePath, validateConfig } from 'src/core/config';
import { DatabaseModule } from 'src/core/database';
import { EmailModule } from 'src/core/email';
import { EventBusModule } from 'src/core/event-bus';
import { GlobalExceptionFilter } from 'src/core/exception';
import { NotEmptyBodyPipe, ResponseInterceptor } from 'src/core/http';
import { AuditInterceptor, AuditModule } from 'src/core/observability/audit';
import { ExceptionTrackerModule } from 'src/core/observability/exception-tracker';
import { LoggerModule } from 'src/core/observability/logger';
import { AuthGuard, AuthRolesGuard } from 'src/core/security/auth';
import { SessionModule } from 'src/core/security/session';
import { TokenModule } from 'src/core/security/token';
import { AdminModule } from 'src/module/admin';
import { AuthModule } from 'src/module/auth';
import { HealthModule } from 'src/module/health';
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
        EventEmitterModule.forRoot(),
        LoggerModule,
        AuditModule,
        ExceptionTrackerModule,
        EventBusModule,
        CacheModule,
        DatabaseModule,
        EmailModule,
        TokenModule,
        SessionModule,
        HealthModule,
        AuthModule,
        UserModule,
        AdminModule,
    ],
    providers: [
        {
            provide: APP_GUARD,
            useClass: AuthGuard,
        },
        {
            provide: APP_GUARD,
            useClass: AuthRolesGuard,
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
        // The ambient audit context is seeded by `auditContextHook` and completed by `AuthGuard`,
        // both of which run before any interceptor — so the actor is already in scope when this
        // records an `@Audited` disclosure.
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
