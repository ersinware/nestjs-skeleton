import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { validateConfig } from './common/config/env.validation.config';
import { GlobalExceptionFilter } from './common/filter/global-exception.filter';
import { FailSafeThrottlerGuard } from './common/guard/fail-safe-throttler.guard';
import { ResponseInterceptor } from './common/interceptor/response.interceptor';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { REDIS_CLIENT } from './redis/constant/redis.constant';
import { RedisModule } from './redis/redis.module';
import { UserModule } from './v1/user/user.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: process.env['NODE_ENV'] === 'test' ? '.env.test' : '.env',
            validate: validateConfig,
        }),
        RedisModule,
        ThrottlerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService, REDIS_CLIENT],
            useFactory: (config: ConfigService, redis: Redis) => ({
                errorMessage: 'Too many requests.',
                throttlers: [
                    {
                        ttl: config.getOrThrow<number>('THROTTLE_TTL'),
                        limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
                    },
                ],
                storage: new ThrottlerStorageRedisService(redis),
            }),
        }),
        HealthModule,
        DatabaseModule,
        UserModule,
    ],
    providers: [
        {
            provide: APP_GUARD,
            useClass: FailSafeThrottlerGuard,
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: ResponseInterceptor,
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
