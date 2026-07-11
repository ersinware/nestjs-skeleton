/**
 * @file email.module.ts
 * @description NestJS module configuring the BullMQ email queue, workers, and Gmail APIs.
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmailerAdapter, EmailQueueAdapter } from 'src/core/email/adapter';
import { QUEUE_EMAIL } from 'src/core/email/constant';
import { TOKEN_EMAIL_QUEUE_PORT, TOKEN_EMAILER_PORT } from 'src/core/email/port';
import { EmailProcessor } from 'src/core/email/processor';

/**
 * Module responsible for configuring background queues and email integrations.
 */
@Module({
    imports: [
        BullModule.registerQueue({
            name: QUEUE_EMAIL,
        }),
    ],
    providers: [
        EmailProcessor,
        {
            provide: TOKEN_EMAIL_QUEUE_PORT,
            useClass: EmailQueueAdapter,
        },
        {
            provide: TOKEN_EMAILER_PORT,
            useClass: EmailerAdapter,
        },
    ],
    exports: [TOKEN_EMAIL_QUEUE_PORT],
})
export class EmailModule {}
