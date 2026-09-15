/**
 * @file delivery-storage.ts
 * @description Owns the shared delivery pool and pg-boss schema clients in the API process.
 */

import { BeforeApplicationShutdown, Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type QueryResult } from 'pg';
import { PgBoss } from 'pg-boss';
import { ENV } from 'src/core/config';
import { createDatabasePool, translateConnectionFailure } from 'src/core/database';
import { assertDeliverySchema } from 'src/core/event-bus/delivery-schema.util';
import { DELIVERY_TOPOLOGY } from 'src/core/event-bus/delivery-topology.constant';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { ConnectionLogMessage, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { DependencyUnavailableException, SystemException } from 'src/shared/exception';

/**
 * Starts only pre-provisioned storage; publishing and consumer registration remain separate.
 */
@Injectable()
export class DeliveryStorage implements OnApplicationBootstrap, BeforeApplicationShutdown {
    /**
     * Shares PostgreSQL connections across all delivery clients.
     */
    private readonly pool: Pool;

    /**
     * Holds one pg-boss client for each configured delivery topology.
     */
    private readonly clients: readonly PgBoss[];

    /**
     * Tracks whether the current delivery-pool outage has already been recorded.
     */
    private isDown = false;

    /**
     * Memoizes coordinated shutdown so cleanup runs only once.
     */
    private shutdown: Promise<void> | undefined;

    /**
     * Creates one shared delivery pool and configures each pg-boss client without runtime provisioning.
     *
     * @param configService Validated connection limits
     * @param loggerPort Connection transitions and vendor warnings
     * @param errorReporterPort Unexpected background failures
     */
    constructor(
        configService: ConfigService,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_ERROR_REPORTER_PORT) private readonly errorReporterPort: IErrorReporterPort,
    ) {
        this.pool = createDatabasePool(
            configService,
            configService.getOrThrow<string>(ENV.DATABASE_URL),
            configService.getOrThrow<number>(ENV.DELIVERY_POOL_SIZE),
        );

        this.pool.on('error', (error) => {
            this.reportBackgroundError(error);
        });

        this.clients = DELIVERY_TOPOLOGY.map(({ schema }) => {
            const boss = new PgBoss({
                schema,
                db: { executeSql: (text, values) => this.executeSql(text, values) },
                migrate: false,
                supervise: true,
                schedule: false,
                useListenNotify: false,
                reindex: false,
            });

            boss.on('error', (error) => {
                this.reportBackgroundError(error);
            });

            boss.on('warning', (warning) => {
                this.loggerPort.warn({
                    class: this.constructor.name,
                    method: 'pg-boss',
                    message: warning.message,
                    data: { schema },
                });
            });

            return boss;
        });
    }

    /**
     * Rejects startup before HTTP listens if any schema or required queue is unprepared.
     */
    async onApplicationBootstrap() {
        try {
            for (const [index, { schema, queues }] of DELIVERY_TOPOLOGY.entries()) {
                const boss = this.clients[index]!;

                await boss.start();
                await assertDeliverySchema(boss, schema, queues);
            }
        } catch (error) {
            try {
                await this.beforeApplicationShutdown();
            } catch (error) {
                const errors: readonly unknown[] =
                    error instanceof SystemException && error.cause instanceof AggregateError
                        ? error.cause.errors
                        : [error];

                for (const error of errors) {
                    if (translateConnectionFailure(error) instanceof DependencyUnavailableException) {
                        this.recordOutage(error);
                    } else {
                        this.errorReporterPort.report(error, {
                            class: this.constructor.name,
                            method: this.beforeApplicationShutdown.name,
                        });
                    }
                }
            }

            throw error;
        }
    }

    /**
     * NestJS shutdown lifecycle hook; keep this method public and named beforeApplicationShutdown.
     * Stops all clients before closing their shared pool and before business pools shut down.
     */
    async beforeApplicationShutdown() {
        this.shutdown ??= this.stop();
        await this.shutdown;
    }

    /**
     * Stops every client even when another client rejects shutdown.
     */
    private async stop() {
        const results = await Promise.allSettled(this.clients.map((boss) => boss.stop({ close: false })));

        results.push(...(await Promise.allSettled([this.pool.end()])));

        const errors = results
            .filter((result) => result.status === 'rejected')
            .map((result) => result.reason as unknown);

        if (errors.length > 0) {
            throw new SystemException('Delivery storage shutdown failed.', { cause: new AggregateError(errors) });
        }
    }

    /**
     * Uses the primary delivery pool, never the ambient business transaction or replica.
     *
     * @param text Vendor SQL
     * @param values Bound parameters
     * @returns Driver rows for pg-boss
     */
    private async executeSql(text: string, values?: unknown[]): Promise<QueryResult<Record<string, unknown>>> {
        try {
            const result = await this.pool.query<Record<string, unknown>>(text, values);

            if (this.isDown) {
                this.isDown = false;

                this.loggerPort.info({
                    class: this.constructor.name,
                    method: this.executeSql.name,
                    message: ConnectionLogMessage.RESTORED,
                });
            }

            return result;
        } catch (error) {
            if (translateConnectionFailure(error) instanceof DependencyUnavailableException) {
                this.recordOutage(error);
            }

            throw error;
        }
    }

    /**
     * Keeps dependency episodes out of Sentry; unexpected vendor errors remain actionable.
     *
     * @param error Driver or pg-boss background error
     */
    private reportBackgroundError(error: unknown) {
        if (translateConnectionFailure(error) instanceof DependencyUnavailableException) {
            this.recordOutage(error);

            return;
        }

        this.errorReporterPort.report(error, { class: this.constructor.name, method: 'constructor' });
    }

    /**
     * Records the first observed failure of this process's shared delivery pool.
     *
     * @param error Original connection failure
     */
    private recordOutage(error: unknown) {
        if (!this.isDown) {
            this.isDown = true;

            this.loggerPort.warn({
                class: this.constructor.name,
                method: this.executeSql.name,
                message: ConnectionLogMessage.LOST,
                error,
            });
        }
    }
}
