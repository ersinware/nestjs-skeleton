/**
 * @file redis-client.factory.ts
 * @description Factory building configured Redis clients with per-episode connection-transition logging.
 * Shared by every concern that owns a Redis connection (cache, session state), so connection policy
 * and outage forensics live in exactly one place.
 */

import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ConnectionLogMessage, type ILoggerPort } from 'src/core/observability/logger';

/**
 * Creates a configured Redis client instance.
 *
 * @param config The config service instance.
 * @param logger The logger service instance.
 * @param env The configuration keys for this specific client.
 * @param token The injection token the client is provided under; its description names the client in logs.
 * @returns The initialized Redis client instance.
 */
export function createRedisClient(
    config: ConfigService,
    logger: ILoggerPort,
    env: {
        host: string;
        port: string;
        password: string;
        tls: string;
        maxRetriesPerRequest: string;
        commandTimeout: string;
    },
    token: symbol,
) {
    const clientName = token.description ?? token.toString(),
        password = config.getOrThrow<string>(env.password),
        redis = new Redis({
            host: config.getOrThrow<string>(env.host),
            port: config.getOrThrow<number>(env.port),
            ...(password ? { password } : {}),
            ...(config.getOrThrow<boolean>(env.tls) ? { tls: {} } : {}),
            maxRetriesPerRequest: config.getOrThrow<number>(env.maxRetriesPerRequest),
            // App duration values are seconds; ioredis expects milliseconds.
            commandTimeout: config.getOrThrow<number>(env.commandTimeout) * 1000,
        });

    // One log per outage episode, gated on a per-client transition flag: ioredis re-emits 'error' on
    // every reconnect attempt while the server is unreachable, so logging each one floods during an
    // outage. No Sentry here — dependency availability alarms are the pager;
    // this pair of transition logs is only the forensic breadcrumb that names the cause and the recovery.
    let isDown = false;

    redis.on('error', (error: Error) => {
        if (isDown) {
            return;
        }

        isDown = true;
        logger.warn({
            class: createRedisClient.name,
            method: `${clientName}.on(error)`,
            message: ConnectionLogMessage.LOST,
            error,
        });
    });

    redis.on('ready', () => {
        if (!isDown) {
            return;
        }

        isDown = false;
        logger.info({
            class: createRedisClient.name,
            method: `${clientName}.on(ready)`,
            message: ConnectionLogMessage.RESTORED,
        });
    });

    return redis;
}
