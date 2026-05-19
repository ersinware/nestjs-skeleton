import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateConfig } from './common/config/env.validation.config';
import { GlobalExceptionFilter } from './common/filter/global-exception.filter';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { UserModule } from './v1/user/user.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: process.env['NODE_ENV'] === 'test' ? '.env.test' : '.env',
            validate: validateConfig,
        }),
        ThrottlerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => [
                {
                    ttl: config.getOrThrow<number>('THROTTLE_TTL'),
                    limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
                },
            ],
        }),
        HealthModule,
        DatabaseModule,
        UserModule,
    ],
    providers: [
        {
            provide: APP_FILTER,
            useClass: GlobalExceptionFilter,
        },
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
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
    ],
})
export class AppModule {}
