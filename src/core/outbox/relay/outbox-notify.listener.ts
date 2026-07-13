/**
 * @file outbox-notify.listener.ts
 * @description Postgres LISTEN/NOTIFY listener that wakes the outbox relay in near real time. On
 * every (re)subscribe it also triggers a drain, so events that arrived while the listener was down
 * are not stranded until the fallback cron.
 */

import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import postgres from 'postgres';
import { ENV } from 'src/core/config';
import { LogPayload } from 'src/core/observability';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/tracker';
import { OutboxRelayService } from 'src/core/outbox/relay/outbox-relay.service';

/**
 * Subscribes to the `outbox_channel` on a dedicated connection and delegates all dispatch work to
 * the shared relay service.
 */
@Injectable()
export class OutboxNotifyListener implements OnModuleInit, OnModuleDestroy {
    private listenClient: postgres.Sql | undefined;
    private listenMeta: postgres.ListenMeta | undefined;

    /**
     * Creates an instance of OutboxNotifyListener.
     *
     * @param loggerPort - Structured logger.
     * @param exceptionTrackerPort - Exception reporter.
     * @param outboxRelayService - Shared relay engine that performs the actual draining.
     * @param configService - Configuration client for the database URL.
     */
    constructor(
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_EXCEPTION_TRACKER_PORT) private readonly exceptionTrackerPort: IExceptionTrackerPort,
        private readonly outboxRelayService: OutboxRelayService,
        private readonly configService: ConfigService,
    ) {}

    /**
     * Opens the dedicated listen connection and subscribes to the outbox channel.
     */
    async onModuleInit() {
        if (!this.configService.getOrThrow<boolean>(ENV.RELAY_ENABLED)) {
            // Traffic-only pods leave the LISTEN/NOTIFY subscription to the dedicated relay deployment.
            return;
        }

        try {
            this.listenClient = postgres(this.configService.getOrThrow<string>(ENV.DATABASE_URL), {
                max: 1, // Listen requires a dedicated connection
                idle_timeout: 0, // Never timeout the listen connection
            });

            this.listenMeta = await this.listenClient.listen(
                'outbox_channel',
                () => {
                    void this.outboxRelayService.requestDrain();
                },
                () => {
                    // Fired on the initial subscribe and on every reconnect: drain immediately so any
                    // notifications missed while the listener was down are recovered without waiting
                    // for the fallback cron. postgres.js resubscribes transparently, so a reconnect
                    // fully self-heals — nothing to log.
                    void this.outboxRelayService.requestDrain();
                },
            );
        } catch (error) {
            this.loggerPort.error(
                new LogPayload({
                    class: OutboxNotifyListener.name,
                    method: this.onModuleInit.name,
                    error,
                }),
            );
            this.exceptionTrackerPort.captureException(error);
        }
    }

    /**
     * Gracefully unsubscribes and closes the dedicated listen connection on shutdown.
     */
    async onModuleDestroy() {
        try {
            if (this.listenMeta) {
                await this.listenMeta.unlisten();
            }

            if (this.listenClient) {
                await this.listenClient.end();
            }
        } catch {
            // The process is shutting down; the OS reclaims the socket regardless, so a failed
            // unlisten/close self-heals. Swallow it only so it does not become an unhandled rejection
            // that disrupts the rest of the shutdown sequence — nothing here is actionable.
        }
    }
}
