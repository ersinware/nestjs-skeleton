import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ENV } from 'src/core/config';
import { transactionStorage } from 'src/core/database';
import { TOKEN_DATABASE } from 'src/core/database/constant';
import { LogPayload } from 'src/core/observability';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/tracker';
import { OutboxStatus } from 'src/core/outbox/enum';
import { TOKEN_OUTBOX_QUEUE_PORT, type IOutboxQueuePort } from 'src/core/outbox/port/outbox-queue.port';
import { TOKEN_OUTBOX_PORT, type IOutboxPort } from 'src/core/outbox/port/outbox.port';

@Injectable()
export class PostgresPubSubService implements OnModuleInit, OnModuleDestroy {
    private listenClient: postgres.Sql | undefined;
    private listenMeta: postgres.ListenMeta | undefined;
    private isProcessing = false;

    constructor(
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_EXCEPTION_TRACKER_PORT) private readonly exceptionTrackerPort: IExceptionTrackerPort,
        @Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase,
        @Inject(TOKEN_OUTBOX_PORT) private readonly outboxPort: IOutboxPort,
        @Inject(TOKEN_OUTBOX_QUEUE_PORT) private readonly outboxQueuePort: IOutboxQueuePort,
        private readonly configService: ConfigService,
    ) {}

    async onModuleInit() {
        try {
            this.listenClient = postgres(this.configService.getOrThrow<string>(ENV.DATABASE_URL), {
                max: 1, // Listen requires a dedicated connection
                idle_timeout: 0, // Never timeout the listen connection
            });

            this.listenMeta = await this.listenClient.listen('outbox_channel', () => {
                void this.handleNotification();
            });
        } catch (error) {
            this.loggerPort.error(
                new LogPayload({
                    class: PostgresPubSubService.name,
                    method: this.onModuleInit.name,
                    error,
                }),
            );
            this.exceptionTrackerPort.captureException(error);
        }
    }

    async onModuleDestroy() {
        if (this.listenMeta) {
            await this.listenMeta.unlisten();
        }

        if (this.listenClient) {
            await this.listenClient.end();
        }
    }

    private async handleNotification() {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        try {
            let hasMore = true;

            while (hasMore) {
                await this.db.transaction(async (tx) => {
                    await transactionStorage.run(tx, async () => {
                        const pendingEvents = await this.outboxPort.getPendingEvents(50);

                        if (pendingEvents.length === 0) {
                            hasMore = false;

                            return;
                        }

                        await this.outboxQueuePort.queueEvents(pendingEvents);
                        await this.outboxPort.updateStatus(
                            pendingEvents.map((event) => event.id),
                            OutboxStatus.QUEUED,
                        );
                    });
                });
            }
        } catch (error) {
            this.loggerPort.error(
                new LogPayload({
                    class: PostgresPubSubService.name,
                    method: this.handleNotification.name,
                    error,
                }),
            );
            this.exceptionTrackerPort.captureException(error);
        } finally {
            this.isProcessing = false;
        }
    }
}
