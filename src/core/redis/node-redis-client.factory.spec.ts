/**
 * @file node-redis-client.factory.spec.ts
 * @description Client configuration and one-log-per-outage episode without opening sockets.
 */

import { ConfigService } from '@nestjs/config';
import { ConnectionLogMessage } from 'src/core/observability/logger';
import { createNodeRedisClient } from 'src/core/redis/node-redis-client.factory';
import { describe, expect, it, vi } from 'vitest';

describe('createNodeRedisClient', () => {
    it.each([false, true])('creates an unconnected fail-closed client with TLS=%s', (tls) => {
        const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
        const client = createNodeRedisClient(
            new ConfigService({
                host: 'localhost',
                port: 6381,
                password: tls ? 'secret' : '',
                tls,
                connectTimeout: 0.5,
            }),
            logger,
            { host: 'host', port: 'port', password: 'password', tls: 'tls', connectTimeout: 'connectTimeout' },
            Symbol('RATE_LIMIT'),
        );
        expect(client.isOpen).toBe(false);
        expect(client.options).toMatchObject({
            disableOfflineQueue: true,
            socket: { host: 'localhost', port: 6381, connectTimeout: 500 },
        });
        expect(client.options?.socket?.tls).toBe(tls ? true : undefined);
        expect(client.options?.password).toBe(tls ? 'secret' : undefined);
    });

    it('logs a loss once per episode and recovery only after a loss', () => {
        const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
        const client = createNodeRedisClient(
            new ConfigService({ host: 'localhost', port: 6381, password: '', tls: false, connectTimeout: 1 }),
            logger,
            { host: 'host', port: 'port', password: 'password', tls: 'tls', connectTimeout: 'connectTimeout' },
            Symbol('RATE_LIMIT'),
        );
        const error = new Error('connection lost');
        client.emit('ready');
        expect(logger.info).not.toHaveBeenCalled();
        client.emit('error', error);
        client.emit('error', error);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ message: ConnectionLogMessage.LOST, error, method: 'RATE_LIMIT.on(error)' }),
        );
        client.emit('ready');
        client.emit('ready');
        expect(logger.info).toHaveBeenCalledTimes(1);
        client.emit('error', error);
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });
});
