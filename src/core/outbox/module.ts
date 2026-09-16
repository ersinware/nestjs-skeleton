/**
 * @file module.ts
 * @description Wires transactional enqueueing and pg-boss event delivery.
 */

import { BeforeApplicationShutdown, Inject, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitterReadinessWatcher } from '@nestjs/event-emitter';
import { PgBoss } from 'pg-boss';
import { ENV } from 'src/core/config';
import { DatabaseModule, translateConnectionFailure } from 'src/core/database';
import { EventBusModule, TOKEN_EVENT_PUBLISHER_PORT, type IEventPublisherPort } from 'src/core/event-bus';
import {
    ErrorReporterModule,
    TOKEN_ERROR_REPORTER_PORT,
    type IErrorReporterPort,
} from 'src/core/observability/error-reporter';
import { OutboxWriterAdapter } from 'src/core/outbox/adapter/outbox-writer.adapter';
import { TOKEN_OUTBOX_CLIENT } from 'src/core/outbox/outbox-client.token';
import type { OutboxEvent } from 'src/core/outbox/outbox-event';
import { OUTBOX_QUEUE } from 'src/core/outbox/outbox-queue';
import { TOKEN_OUTBOX_WRITER_PORT } from 'src/core/outbox/port/outbox-writer.port';
import { DependencyUnavailableException } from 'src/shared/exception';

/**
 * Owns the queue lifecycle; pg-boss owns its schema, claims and retries.
 */
@Module({
    imports: [DatabaseModule, EventBusModule, ErrorReporterModule],
    providers: [
        {
            provide: TOKEN_OUTBOX_CLIENT,
            useFactory: async (
                configService: ConfigService,
                errorReporterPort: IErrorReporterPort,
            ): Promise<PgBoss> => {
                const boss = new PgBoss({
                    connectionString: configService.getOrThrow<string>(ENV.DATABASE_URL),
                    max: configService.getOrThrow<number>(ENV.JOB_QUEUE_POOL_SIZE),
                    connectionTimeoutMillis: configService.getOrThrow<number>(ENV.DATABASE_CONNECT_TIMEOUT) * 1000,
                    schedule: false,
                });

                boss.on('error', (error) => {
                    if (!(translateConnectionFailure(error) instanceof DependencyUnavailableException)) {
                        errorReporterPort.report(error, { class: OutboxModule.name, method: 'boss.on' });
                    }
                });

                try {
                    await boss.start();
                    await boss.createQueue(OUTBOX_QUEUE, {
                        policy: 'standard',
                        retryLimit: 10,
                        retryDelay: 5,
                        retryBackoff: true,
                        retryDelayMax: 300,
                    });

                    return boss;
                } catch (error) {
                    await boss.stop({ graceful: false });

                    throw error;
                }
            },
            inject: [ConfigService, TOKEN_ERROR_REPORTER_PORT],
        },
        { provide: TOKEN_OUTBOX_WRITER_PORT, useClass: OutboxWriterAdapter },
    ],
    exports: [TOKEN_OUTBOX_WRITER_PORT],
})
export class OutboxModule implements OnApplicationBootstrap, BeforeApplicationShutdown {
    /**
     * Connects durable delivery to the existing listeners.
     *
     * @param boss Initialized queue client
     * @param eventPublisherPort Awaited in-process publisher
     * @param readinessWatcher Listener registration barrier
     * @param errorReporterPort Background failure reporting boundary
     */
    constructor(
        @Inject(TOKEN_OUTBOX_CLIENT) private readonly boss: PgBoss,
        @Inject(TOKEN_EVENT_PUBLISHER_PORT) private readonly eventPublisherPort: IEventPublisherPort,
        private readonly readinessWatcher: EventEmitterReadinessWatcher,
        @Inject(TOKEN_ERROR_REPORTER_PORT) private readonly errorReporterPort: IErrorReporterPort,
    ) {}

    /**
     * Registers competing workers; each failed event retries independently.
     */
    async onApplicationBootstrap() {
        await this.boss.work<OutboxEvent>(
            OUTBOX_QUEUE,
            { batchSize: 1, localConcurrency: 5, pollingIntervalSeconds: 5 },
            async (jobs) => {
                // Wait inside the callback so Nest can finish other modules' bootstrap hooks.
                await this.readinessWatcher.waitUntilReady();

                for (const { data } of jobs) {
                    try {
                        await this.eventPublisherPort.publish(data.eventType, {
                            aggregateId: data.aggregateId,
                        });
                    } catch (error) {
                        if (!(translateConnectionFailure(error) instanceof DependencyUnavailableException)) {
                            this.errorReporterPort.report(error, {
                                class: OutboxModule.name,
                                method: 'boss.work',
                                data,
                            });
                        }

                        throw error;
                    }
                }
            },
        );
    }

    /**
     * Drains workers before application shutdown removes listeners and closes database pools.
     */
    async beforeApplicationShutdown() {
        await this.boss.stop({ graceful: true, timeout: 30000 });
    }
}
