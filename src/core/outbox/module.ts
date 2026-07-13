/**
 * @file module.ts
 * @description Outbox module wiring: the BullMQ queue (with its own job policy), the Postgres
 * LISTEN/NOTIFY listener, the shared relay engine, the relay + prune cron jobs, and the processor.
 */

import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { OutboxLedgerAdapter, OutboxQueueAdapter, TransactionalOutboxAdapter } from 'src/core/outbox/adapter';
import { OUTBOX_QUEUE_ATTEMPTS, OUTBOX_QUEUE_BACKOFF_MS, OUTBOX_QUEUE_NAME } from 'src/core/outbox/constant';
import { OutboxPruneCron } from 'src/core/outbox/cron/outbox-prune.cron';
import { OutboxRelayCron } from 'src/core/outbox/cron/outbox-relay.cron';
import {
    TOKEN_OUTBOX_LEDGER_PORT,
    TOKEN_OUTBOX_QUEUE_PORT,
    TOKEN_TRANSACTIONAL_OUTBOX_PORT,
} from 'src/core/outbox/port';
import { OutboxProcessor } from 'src/core/outbox/processor';
import { OutboxNotifyListener } from 'src/core/outbox/relay/outbox-notify.listener';
import { OutboxRelayService } from 'src/core/outbox/relay/outbox-relay.service';

@Global()
@Module({
    imports: [
        // Outbox relay jobs only touch internal infra (DB, Redis, event bus), which recovers within
        // seconds, so a tight exponential backoff drains transient failures fast.
        BullModule.registerQueue({
            name: OUTBOX_QUEUE_NAME,
            defaultJobOptions: {
                attempts: OUTBOX_QUEUE_ATTEMPTS,
                backoff: {
                    type: 'exponential',
                    delay: OUTBOX_QUEUE_BACKOFF_MS,
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
        OutboxRelayService,
        OutboxNotifyListener,
        OutboxRelayCron,
        OutboxPruneCron,
        OutboxProcessor,
        {
            provide: TOKEN_OUTBOX_LEDGER_PORT,
            useClass: OutboxLedgerAdapter,
        },
        {
            provide: TOKEN_OUTBOX_QUEUE_PORT,
            useClass: OutboxQueueAdapter,
        },
        {
            provide: TOKEN_TRANSACTIONAL_OUTBOX_PORT,
            useClass: TransactionalOutboxAdapter,
        },
    ],
    exports: [TOKEN_OUTBOX_LEDGER_PORT, TOKEN_OUTBOX_QUEUE_PORT, TOKEN_TRANSACTIONAL_OUTBOX_PORT],
})
export class OutboxModule {}
