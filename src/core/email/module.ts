/**
 * @file email.module.ts
 * @description NestJS module wiring the durable email pipeline: the email ledger, the relay engine,
 * the relay + prune cron jobs, the BullMQ email queue (with its own job policy), the worker, and the
 * Gmail API adapter.
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmailerAdapter, EmailIntakeAdapter, EmailLedgerAdapter, EmailQueueAdapter } from 'src/core/email/adapter';
import { EMAIL_QUEUE_ATTEMPTS, EMAIL_QUEUE_BACKOFF_MS, EMAIL_QUEUE_NAME } from 'src/core/email/constant';
import { EmailPruneCron, EmailRelayCron } from 'src/core/email/cron';
import {
    TOKEN_EMAIL_INTAKE_PORT,
    TOKEN_EMAIL_LEDGER_PORT,
    TOKEN_EMAIL_QUEUE_PORT,
    TOKEN_EMAILER_PORT,
} from 'src/core/email/port';
import { EmailProcessor } from 'src/core/email/processor';
import { EmailRelayService } from 'src/core/email/relay/email-relay.service';

/**
 * Module responsible for configuring the durable, reliable email delivery pipeline.
 */
@Module({
    imports: [
        // Email jobs hit an external, rate-limited provider (Gmail API), so recovery windows are
        // measured in minutes, not seconds. A longer base backoff and one extra attempt avoid
        // burning all retries inside a single 429/quota window.
        BullModule.registerQueue({
            name: EMAIL_QUEUE_NAME,
            defaultJobOptions: {
                attempts: EMAIL_QUEUE_ATTEMPTS,
                backoff: {
                    type: 'exponential',
                    delay: EMAIL_QUEUE_BACKOFF_MS,
                },
                removeOnComplete: {
                    age: 24 * 60 * 60,
                    count: 1000,
                },
                removeOnFail: {
                    age: 7 * 24 * 60 * 60,
                },
            },
        }),
    ],
    providers: [
        EmailRelayService,
        EmailRelayCron,
        EmailPruneCron,
        EmailProcessor,
        {
            provide: TOKEN_EMAIL_LEDGER_PORT,
            useClass: EmailLedgerAdapter,
        },
        {
            provide: TOKEN_EMAIL_QUEUE_PORT,
            useClass: EmailQueueAdapter,
        },
        {
            provide: TOKEN_EMAIL_INTAKE_PORT,
            useClass: EmailIntakeAdapter,
        },
        {
            provide: TOKEN_EMAILER_PORT,
            useClass: EmailerAdapter,
        },
    ],
    exports: [TOKEN_EMAIL_INTAKE_PORT, TOKEN_EMAIL_LEDGER_PORT, TOKEN_EMAIL_QUEUE_PORT],
})
export class EmailModule {}
