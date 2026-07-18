/**
 * @file email.module.ts
 * @description NestJS module wiring the Gmail API adapter behind the emailer port.
 */

import { Module } from '@nestjs/common';
import { EmailerAdapter } from 'src/core/email/adapter/emailer.adapter';
import { TOKEN_EMAILER_PORT } from 'src/core/email/port/emailer.port';

/**
 * Module responsible for exposing email delivery to the rest of the application.
 */
@Module({
    providers: [
        {
            provide: TOKEN_EMAILER_PORT,
            useClass: EmailerAdapter,
        },
    ],
    exports: [TOKEN_EMAILER_PORT],
})
export class EmailModule {}
