/**
 * @file job-queue.adapter.ts
 * @description Owns pg-boss clients, a shared pool and atomic job acceptance in the API process.
 */

import { BeforeApplicationShutdown, Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type QueryResult } from 'pg';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { ENV } from 'src/core/config';
import {
    TOKEN_DATABASE_CLIENT,
    TOKEN_TRANSACTION_PORT,
    createDatabasePool,
    translateConnectionFailure,
    type ITransactionPort,
} from 'src/core/database';
import { assertJobQueueSchema } from 'src/core/job-queue/job-queue-schema.util';
import { createJobQueueTopology } from 'src/core/job-queue/job-queue-topology.util';
import type { IJobQueuePort, JobQueueDefinition } from 'src/core/job-queue/port/job-queue.port';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { ConnectionLogMessage, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { DependencyUnavailableException, SystemException } from 'src/shared/exception';

/**
 * Starts only pre-provisioned storage; publishing and consumer registration remain separate.
 */
@Injectable()
export class JobQueueAdapter implements IJobQueuePort, OnApplicationBootstrap, BeforeApplicationShutdown {
    /**
     * Shares PostgreSQL connections across all queue clients.
     */
    private readonly pool: Pool;

    /**
     * Holds one pg-boss client for each registered queue schema.
     */
    private readonly clients: PgBoss[] = [];

    /**
     * Provisioning expectations derived from registered queue inventories.
     */
    private readonly topology: ReturnType<typeof createJobQueueTopology>[] = [];

    /**
     * Tracks whether the current delivery-pool outage has already been recorded.
     */
    private isDown = false;

    /**
     * Memoizes coordinated shutdown so cleanup runs only once.
     */
    private shutdown: Promise<void> | undefined;

    /**
     * Creates the shared delivery pool; queue registrations configure its clients.
     *
     * @param configService Validated connection limits
     * @param loggerPort Connection transitions and vendor warnings
     * @param errorReporterPort Unexpected background failures
     * @param database ALS-aware primary database proxy for job insertion
     * @param transactionPort Opens or joins atomic job acceptance
     */
    constructor(
        configService: ConfigService,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_ERROR_REPORTER_PORT) private readonly errorReporterPort: IErrorReporterPort,
        @Inject(TOKEN_DATABASE_CLIENT) private readonly database: NodePgDatabase,
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
    ) {
        this.pool = createDatabasePool(
            configService,
            configService.getOrThrow<string>(ENV.DATABASE_URL),
            configService.getOrThrow<number>(ENV.DELIVERY_POOL_SIZE),
        );

        this.pool.on('error', (error) => {
            this.reportBackgroundError(error);
        });
    }

    /**
     * Registers caller-owned queues during dependency construction, before storage bootstrap.
     *
     * @param definition Caller-owned schema and source queues
     */
    register(definition: JobQueueDefinition) {
        if (this.topology.some(({ schema }) => schema === definition.schema)) {
            return;
        }

        const { schema } = definition,
            boss = new PgBoss({
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

        this.topology.push(createJobQueueTopology(definition));
        this.clients.push(boss);
    }

    /**
     * Rejects startup before HTTP listens if any schema or required queue is unprepared.
     */
    async onApplicationBootstrap() {
        try {
            for (const [index, { schema, queues }] of this.topology.entries()) {
                const boss = this.clients[index]!;

                await boss.start();
                await assertJobQueueSchema(boss, schema, queues);
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
     * Inserts all target jobs through one ALS-aware transaction without interpreting their data.
     *
     * @param schema Registered queue namespace
     * @param targetQueues Source queues receiving the jobs
     * @param data Caller-owned JSON-serializable job data
     */
    async enqueue(
        schema: string,
        targetQueues: readonly [string, ...string[]],
        data: Readonly<Record<string, unknown>>,
    ) {
        const boss = this.getClient(schema);

        await this.transactionPort.run(async () => {
            const db = fromDrizzle(this.database, sql),
                promises = targetQueues.map(async (name) => {
                    if (!(await boss.send(name, data, { db }))) {
                        throw new SystemException(`Job was not accepted: ${schema}.${name}.`);
                    }
                });

            try {
                await Promise.all(promises);
            } catch (error) {
                // Promise.all does not cancel queued SQL; settle every send before leaving the transaction.
                await Promise.allSettled(promises);

                throw error;
            }
        });
    }

    /**
     * Resolves an infrastructure client without exposing vendor APIs to application callers.
     *
     * @param schema Registered queue schema
     * @returns The shared storage's client for this schema
     * @throws {SystemException} When the schema is not provisioned in the topology
     */
    private getClient(schema: string): PgBoss {
        const client = this.clients[this.topology.findIndex((definition) => definition.schema === schema)];

        if (!client) {
            throw new SystemException(`Unknown delivery schema: ${schema}.`);
        }

        return client;
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
