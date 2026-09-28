/**
 * @file module.ts
 * @description NestJS module binding the emailer port to an adapter chosen by environment.
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ENV, Environment } from 'src/core/config';
import { EmailerAdapter } from 'src/core/email/adapter/emailer.adapter';
import { NoopEmailerAdapter } from 'src/core/email/adapter/noop-emailer.adapter';
import { TOKEN_EMAILER_PORT } from 'src/core/email/port/emailer.port';

/**
 * Exposes email delivery to the rest of the application. The environment decides the
 * binding: test gets the no-op adapter (no provider call or quota spent),
 * every other environment gets the Resend adapter.
 */
@Module({
    providers: [
        {
            provide: TOKEN_EMAILER_PORT,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) =>
                configService.getOrThrow<Environment>(ENV.NODE_ENV) === Environment.TEST
                    ? new NoopEmailerAdapter()
                    : new EmailerAdapter(configService),
        },
    ],
    exports: [TOKEN_EMAILER_PORT],
})
export class EmailModule {}
