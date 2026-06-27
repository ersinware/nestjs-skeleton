/**
 * @file app.module.ts
 * @description The root module of the application. It constructs the application's dependency tree by aggregating all configuration, security, database, infrastructure, and business logic modules. It also registers global guards, pipes, interceptors, and exception filters that apply across the entire application.
 */

import { BullModule } from '@nestjs/bullmq';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Environment } from 'src/common/config/enum/environment.enum';
import { HealthModule } from './api/health/health.module';
import { AdminModule } from './api/v1/admin/admin.module';
import { AuthModule } from './api/v1/auth/auth.module';
import { UserModule } from './api/v1/user/user.module';
import { AuthRolesGuard } from './common/auth/guard/auth-roles.guard';
import { AuthGuard } from './common/auth/guard/auth.guard';
import { ENV } from './common/config/constant/env.constant';
import { validateConfig } from './common/config/env.validation.config';
import { GlobalExceptionFilter } from './common/exception/filter/global-exception.filter';
import { ResponseInterceptor } from './common/interceptor/response.interceptor';
import { NotEmptyBodyPipe } from './common/validation/pipe/not-empty-body.pipe';
import { CacheModule } from './infrastructure/cache/cache.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { EmailModule } from './infrastructure/email/email.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { SessionModule } from './infrastructure/security/session/session.module';
import { TokenModule } from './infrastructure/security/token/token.module';
import { ThrottleModule } from './infrastructure/throttle/throttle.module';

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
        CacheModule,
        ThrottleModule,
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
