/**
 * @file app.module.ts
 * @description Main application module aggregating configuration, security, database, and business modules.
 * Sets up global guards, pipes, interceptors, and exception filters.
 */

import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { CacheModule } from './cache/cache.module';
import { TOKEN_CACHE_STATE_CLIENT } from './cache/constant/cache.constant';
import { ENV } from './common/config/constant/env.constant';
import { validateConfig } from './common/config/env.validation.config';
import { Environment } from 'src/common/enum/config/environment.enum';
import { GlobalExceptionFilter } from './common/filter/global-exception.filter';
import { FailSafeThrottlerGuard } from './common/guard/fail-safe-throttler.guard';
import { AuthGuard } from './common/guard/auth.guard';
import { AuthRolesGuard } from './common/guard/auth-roles.guard';
import { ResponseInterceptor } from './common/interceptor/response.interceptor';
import { DatabaseModule } from './database/database.module';
import { HashingModule } from './common/hashing/hashing.module';
import { HealthModule } from './health/health.module';
import { AdminModule } from './v1/admin/admin.module';
import { AuthModule } from './v1/auth/auth.module';
import { UserModule } from './v1/user/user.module';
import { NotEmptyBodyPipe } from './common/pipe/not-empty-body.pipe';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { getLoggerConfig } from './common/config/logger.config';
import { EmailModule } from './email/email.module';

/**
 * The root module of the NestJS application.
 * Imports essential modules and registers application-wide cross-cutting concerns.
 */
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: process.env[ENV.NODE_ENV] === Environment.TEST ? '.env.test' : '.env',
            validate: validateConfig,
        }),
        LoggerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: getLoggerConfig,
        }),
        CacheModule,
        ThrottlerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService, TOKEN_CACHE_STATE_CLIENT],
            useFactory: (config: ConfigService, redis: Redis) => ({
                errorMessage: 'Too many requests.',
                throttlers: [
                    {
                        ttl: config.getOrThrow<number>(ENV.THROTTLE_TTL),
                        limit: config.getOrThrow<number>(ENV.THROTTLE_LIMIT),
                    },
                ],
                storage: new ThrottlerStorageRedisService(redis),
            }),
        }),
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
        DatabaseModule,
        HealthModule,
        HashingModule,
        EmailModule,
        AuthModule,
        UserModule,
        AdminModule,
    ],
    providers: [
        {
            provide: APP_GUARD,
            useClass: FailSafeThrottlerGuard,
        },
        {
            provide: APP_GUARD,
            useClass: AuthGuard,
        },
        {
            provide: APP_GUARD,
            useClass: AuthRolesGuard,
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: ResponseInterceptor,
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
            provide: APP_FILTER,
            useClass: GlobalExceptionFilter,
        },
    ],
})
export class AppModule {}
