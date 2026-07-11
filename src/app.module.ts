/**
 * @file app.module.ts
 * @description The root module of the application. It constructs the application's dependency tree by aggregating all configuration, security, database, infrastructure, and business logic modules. It also registers global guards, pipes, interceptors, and exception filters that apply across the entire application.
 */

import { BullModule } from '@nestjs/bullmq';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from 'src/core/cache';
import { ENV, Environment, validateConfig } from 'src/core/config';
import { DatabaseModule } from 'src/core/database';
import { EmailModule } from 'src/core/email/module';
import { EventBusModule } from 'src/core/event-bus';
import { GlobalExceptionFilter } from 'src/core/exception';
import { NotEmptyBodyPipe, ResponseInterceptor } from 'src/core/http';
import { LoggerModule, TrackerModule } from 'src/core/observability';
import { OutboxModule } from 'src/core/outbox';
import { AuthGuard, AuthRolesGuard, SessionModule, ThrottleModule, TokenModule } from 'src/core/security';
import { AdminModule } from 'src/module/admin';
import { AuthModule } from 'src/module/auth';
import { HealthModule } from 'src/module/health';
import { UserModule } from 'src/module/user';

/**
 * The root module class of the NestJS application.
 * Ensures the initialization of all essential core modules (database, logging, caching, etc.) and registers cross-cutting concerns across the application.
 */
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: process.env[ENV.NODE_ENV] === Environment.TEST ? '.env.test' : '.env',
            validate: validateConfig,
        }),
        ScheduleModule.forRoot(),
        EventEmitterModule.forRoot(),
        BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                const password = config.getOrThrow<string>(ENV.REDIS_STATE_PASSWORD);

                return {
                    connection: {
                        host: config.getOrThrow<string>(ENV.REDIS_STATE_HOST),
                        port: config.getOrThrow<number>(ENV.REDIS_STATE_PORT),
                        ...(password ? { password } : {}),
                    },
                };
            },
        }),
        LoggerModule,
        TrackerModule,
        EventBusModule,
        CacheModule,
        ThrottleModule,
        DatabaseModule,
        EmailModule,
        TokenModule,
        SessionModule,
        OutboxModule,
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
