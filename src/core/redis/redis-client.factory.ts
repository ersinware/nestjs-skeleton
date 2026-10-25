/**
 * @file redis-client.factory.ts
 * @description Factory building configured Redis clients with per-episode connection-transition logging.
 * Shared by concerns using ioredis, including cache and session state.
 */

import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ConnectionLogMessage, type ILoggerPort } from 'src/core/observability/logger';

/**
 * Creates a configured Redis client instance.
 *
 * @param configService The config service instance.
 * @param logger The logger service instance.
 * @param env.host Configuration key for the Redis hostname or IP address.
 * @param env.port Configuration key for the Redis TCP port.
 * @param env.password Configuration key for the Redis password; an empty value disables authentication.
 * @param env.tls Configuration key controlling TLS for this connection.
 * @param env.connectTimeout Configuration key for the connection timeout in seconds.
 * @param env.maxRetriesPerRequest Configuration key limiting retries for pending requests.
 * @param env.commandTimeout Configuration key for the command response timeout in seconds.
 * @param token The injection token the client is provided under; its description names the client in logs.
 * @returns The initialized Redis client instance.
 */
export function createRedisClient(
    configService: ConfigService,
    logger: ILoggerPort,
    env: {
        readonly host: string;
        readonly port: string;
        readonly password: string;
        readonly tls: string;
        readonly connectTimeout: string;
        readonly maxRetriesPerRequest: string;
        readonly commandTimeout: string;
    },
    token: symbol,
): Redis {
    const clientName = token.description ?? token.toString(),
        password = configService.getOrThrow<string>(env.password),
        redis = new Redis({
            host: configService.getOrThrow<string>(env.host),
            port: configService.getOrThrow<number>(env.port),
            ...(password ? { password } : {}),
            ...(configService.getOrThrow<boolean>(env.tls) ? { tls: {} } : {}),
            // App duration values are seconds; ioredis expects milliseconds.
            connectTimeout: configService.getOrThrow<number>(env.connectTimeout) * 1000,
            maxRetriesPerRequest: configService.getOrThrow<number>(env.maxRetriesPerRequest),
            commandTimeout: configService.getOrThrow<number>(env.commandTimeout) * 1000,
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
