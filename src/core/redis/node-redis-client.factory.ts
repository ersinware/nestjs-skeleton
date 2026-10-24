/**
 * @file node-redis-client.factory.ts
 * @description Creates node-redis connections with fail-closed queueing and per-episode transition logging.
 */

import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';
import { ConnectionLogMessage, type ILoggerPort } from 'src/core/observability/logger';

/**
 * Creates an unconnected client; its concern owns startup and shutdown.
 *
 * @param config Validated application configuration.
 * @param logger Connection transition logger.
 * @param env Keys for this client's connection settings.
 * @param token Connection identity used in transition logs.
 * @returns A client that never queues offline work or replays unacknowledged commands on reconnect.
 */
export function createNodeRedisClient(
    config: ConfigService,
    logger: ILoggerPort,
    env: {
        readonly host: string;
        readonly port: string;
        readonly password: string;
        readonly tls: string;
        readonly connectTimeout: string;
    },
    token: symbol,
): RedisClientType {
    const clientName = token.description ?? token.toString(),
        password = config.getOrThrow<string>(env.password),
        redis = createClient({
            // On disconnect, node-redis flushes both unsent and unacknowledged commands.
            disableOfflineQueue: true,
            ...(password ? { password } : {}),
            socket: {
                host: config.getOrThrow<string>(env.host),
                port: config.getOrThrow<number>(env.port),
                connectTimeout: config.getOrThrow<number>(env.connectTimeout) * 1000,
                ...(config.getOrThrow<boolean>(env.tls) ? { tls: true as const } : {}),
            },
        });

    let isDown = false;

    redis.on('error', (error: Error) => {
        if (isDown) {
            return;
        }

        isDown = true;
        logger.warn({
            class: createNodeRedisClient.name,
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
            class: createNodeRedisClient.name,
            method: `${clientName}.on(ready)`,
            message: ConnectionLogMessage.RESTORED,
        });
    });

    return redis;
}
