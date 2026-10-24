/**
 * @file node-redis-error.util.spec.ts
 * @description Known node-redis outage classification without masking configuration and programming failures.
 */

import {
    AbortError,
    ClientClosedError,
    ClientOfflineError,
    ConnectionTimeoutError,
    ErrorReply,
    SocketClosedUnexpectedlyError,
    SocketTimeoutError,
    TimeoutError,
} from 'redis';
import { isNodeRedisUnavailable } from 'src/core/redis/node-redis-error.util';
import { describe, expect, it } from 'vitest';

describe('isNodeRedisUnavailable', () => {
    it.each([
        new ClientClosedError(),
        new ClientOfflineError(),
        new ConnectionTimeoutError(),
        new SocketClosedUnexpectedlyError(),
        new SocketTimeoutError(100),
        new TimeoutError(),
        new AbortError(),
        Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
        new ErrorReply('OOM command not allowed'),
        new ErrorReply('LOADING Redis is loading'),
        new ErrorReply('BUSY Redis is busy'),
        new ErrorReply('TRYAGAIN retry'),
        new ErrorReply('CLUSTERDOWN cluster down'),
        new ErrorReply('MASTERDOWN master down'),
        new ErrorReply('ERR max number of clients reached'),
    ])('recognizes %s through nested causes', (error) => {
        expect(isNodeRedisUnavailable(new Error('wrapper', { cause: error }))).toBe(true);
    });

    it.each([
        undefined,
        null,
        'ECONNRESET',
        new Error('unknown'),
        new ErrorReply('WRONGPASS bad password'),
        new ErrorReply('NOPERM forbidden'),
        new ErrorReply('ERR Error running script'),
        new ErrorReply('NOSCRIPT No matching script'),
        new ErrorReply('WRONGTYPE invalid value'),
    ])('does not mask %s as an outage', (error) => {
        expect(isNodeRedisUnavailable(error)).toBe(false);
    });
});
