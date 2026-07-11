/**
 * @file module.ts
 * @description Outbox module that registers the BullMQ queue, Postgres listeners, cron job, and processor.
 */

import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { OutboxAdapter, OutboxQueueAdapter, TransactionalOutboxAdapter } from 'src/core/outbox/adapter';
import { OUTBOX_QUEUE_NAME } from 'src/core/outbox/constant';
import { OutboxRelayCron } from 'src/core/outbox/cron/outbox-relay.cron';
import { TOKEN_OUTBOX_PORT, TOKEN_OUTBOX_QUEUE_PORT, TOKEN_TRANSACTIONAL_OUTBOX_PORT } from 'src/core/outbox/port';
import { OutboxProcessor } from 'src/core/outbox/processor/outbox.processor';
import { PostgresPubSubService } from 'src/core/outbox/service/postgres-pub-sub.service';

@Global()
@Module({
    imports: [
        BullModule.registerQueue({
            name: OUTBOX_QUEUE_NAME,
        }),
    ],
    providers: [
        PostgresPubSubService,
        OutboxRelayCron,
        OutboxProcessor,
        {
            provide: TOKEN_OUTBOX_PORT,
            useClass: OutboxAdapter,
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
    exports: [TOKEN_OUTBOX_PORT, TOKEN_TRANSACTIONAL_OUTBOX_PORT],
})
export class OutboxModule {}
