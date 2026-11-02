/**
 * @file job-queue-notification-subscription.ts
 * @description Owns one reconnecting PostgreSQL LISTEN/NOTIFY subscription for pg-boss.
 */

import type { Notification, Pool, PoolClient } from 'pg';
import type { Db } from 'pg-boss';
import { ConnectionLogMessage, type ILoggerPort } from 'src/core/observability/logger';
import { toError } from 'src/shared/exception';

/**
 * Close handle required by the pg-boss LISTEN/NOTIFY adapter contract.
 */
type ListenHandle = Awaited<ReturnType<NonNullable<Db['listen']>>>;

/**
 * Owns the connection and recovery state for one pg-boss notification subscription.
 */
export class JobQueueNotificationSubscription implements ListenHandle {
    /**
     * Whether the subscription has been permanently closed.
     */
    private closed = false;

    /**
     * Session-pinned listener client, or `null` while disconnected.
     */
    private client: PoolClient | null = null;

    /**
     * Whether the listener has completed its first subscription.
     */
    private established = false;

    /**
     * Whether a connection outage is waiting for a restoration log.
     */
    private outageActive = false;

    /**
     * Number of consecutive reconnect attempts used for exponential backoff.
     */
    private reconnectAttempt = 0;

    /**
     * Pending reconnect timer, if one has been scheduled.
     */
    private reconnectTimer: NodeJS.Timeout | null = null;

    /**
     * Forwards notification payloads from the active listener client to pg-boss.
     */
    private readonly onClientNotification = (message: Notification) => {
        if (message.payload !== undefined) {
            this.onNotification(message.payload);
        }
    };

    /**
     * Discards a failed client, logs the outage, and starts recovery.
     */
    private readonly onClientError = (error: Error) => this.disconnect(error);

    /**
     * Releases an ended client and starts recovery without logging an error outage.
     */
    private readonly onClientEnd = () => this.disconnect();

    /**
     * Creates a reconnecting subscription even if its first LISTEN fails; pg-boss owns polling.
     *
     * @param options.pool Dedicated job-queue PostgreSQL pool
     * @param options.loggerPort Records listener outage transitions
     * @param options.channel PostgreSQL notification channel selected by pg-boss
     * @param options.onNotification Delivers queue-name wake-up hints
     * @param options.onReconnect Signals successful subscription so workers recover missed notifications
     * @returns Healthy or reconnecting notification subscription
     */
    static async open(options: {
        readonly pool: Pool;
        readonly loggerPort: ILoggerPort;
        readonly channel: string;
        readonly onNotification: (payload: string) => void;
        readonly onReconnect: () => void;
    }): Promise<JobQueueNotificationSubscription> {
        const subscription = new JobQueueNotificationSubscription(
            options.pool,
            options.loggerPort,
            options.channel,
            options.onNotification,
            options.onReconnect,
        );

        try {
            await subscription.connect();
        } catch (error) {
            subscription.recordConnectionLoss(toError(error));
            subscription.scheduleReconnect();
        }

        return subscription;
    }

    /**
     * Initializes one unopened notification subscription.
     *
     * @param pool Dedicated job-queue PostgreSQL pool
     * @param loggerPort Records listener outage transitions
     * @param channel PostgreSQL notification channel selected by pg-boss
     * @param onNotification Delivers queue-name wake-up hints
     * @param onReconnect Signals successful subscription so workers recover missed notifications
     */
    private constructor(
        private readonly pool: Pool,
        private readonly loggerPort: ILoggerPort,
        private readonly channel: string,
        private readonly onNotification: (payload: string) => void,
        private readonly onReconnect: () => void,
    ) {}

    /**
     * Stops reconnect attempts and releases the listener connection.
     */
    close(): Promise<void> {
        this.closed = true;

        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.client !== null) {
            this.releaseClient(this.client);
        }

        return Promise.resolve();
    }

    /**
     * Checks out a client and subscribes it to the notification channel.
     */
    private async connect() {
        if (this.closed) {
            return;
        }

        const client = await this.pool.connect();

        if (this.closed) {
            client.release();

            return;
        }

        this.client = client;
        client.on('error', this.onClientError);
        client.on('end', this.onClientEnd);
        client.on('notification', this.onClientNotification);

        try {
            await client.query(`LISTEN ${this.channel}`);

            if (this.client !== client) {
                if (this.closed) {
                    return;
                }

                throw new Error('Job queue listener connection ended while subscribing.');
            }

            this.onReconnect();

            if (this.client !== client) {
                if (this.closed) {
                    return;
                }

                throw new Error('Job queue listener connection ended during reconnect recovery.');
            }
        } catch (error) {
            this.releaseClient(client, toError(error));

            throw error;
        }

        this.established = true;
        this.reconnectAttempt = 0;
        this.recordConnectionRecovery();
    }

    /**
     * Releases a disconnected client and starts recovery, logging only driver errors.
     *
     * @param error Driver error, when provided by the client
     */
    private disconnect(error?: Error) {
        if (this.closed || this.client === null) {
            return;
        }

        this.releaseClient(this.client, error);

        if (error !== undefined) {
            this.recordConnectionLoss(error);
        }

        if (this.established) {
            this.scheduleReconnect();
        }
    }

    /**
     * Schedules one capped exponential-backoff reconnect attempt.
     */
    private scheduleReconnect() {
        if (this.closed || this.reconnectTimer !== null) {
            return;
        }

        this.reconnectAttempt++;
        this.reconnectTimer = setTimeout(
            () => {
                this.reconnectTimer = null;
                void this.connect().catch(() => this.scheduleReconnect());
            },
            Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5)),
        );
    }

    /**
     * Releases the active client and removes the subscription's handlers.
     *
     * @param client Session-pinned listener client
     * @param error Failure requiring the pool to discard the connection
     */
    private releaseClient(client: PoolClient, error?: Error) {
        if (this.client !== client) {
            return;
        }

        client.removeListener('error', this.onClientError);
        client.removeListener('end', this.onClientEnd);
        client.removeListener('notification', this.onClientNotification);
        client.release(error);
        this.client = null;
    }

    /**
     * Logs the first connection loss in an outage episode.
     *
     * @param error Driver error reported by the client
     */
    private recordConnectionLoss(error: Error) {
        if (this.outageActive) {
            return;
        }

        this.outageActive = true;
        this.loggerPort.warn({
            class: this.constructor.name,
            method: this.recordConnectionLoss.name,
            message: ConnectionLogMessage.LOST,
            error,
        });
    }

    /**
     * Logs recovery once after an outage episode.
     */
    private recordConnectionRecovery() {
        if (!this.outageActive) {
            return;
        }

        this.outageActive = false;
        this.loggerPort.info({
            class: this.constructor.name,
            method: this.recordConnectionRecovery.name,
            message: ConnectionLogMessage.RESTORED,
        });
    }
}
