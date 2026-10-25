/**
 * @file rate-limit-stage.runner.spec.ts
 * @description Stage selection, shared counter identity and first-refusal execution boundaries.
 */

import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { TargetAccountTrackerResolverAdapter } from 'src/core/security/rate-limiting/adapter/target-account-tracker-resolver.adapter';
import { KEY_DECORATOR_RATE_LIMIT_EXEMPT } from 'src/core/security/rate-limiting/decorator/rate-limit-exempt.decorator';
import { KEY_DECORATOR_RATE_LIMIT } from 'src/core/security/rate-limiting/decorator/rate-limit.decorator';
import type { IRateLimitCounterPort } from 'src/core/security/rate-limiting/port/rate-limit-counter.port';
import { RateLimitPolicy } from 'src/core/security/rate-limiting/rate-limit-policy';
import { RateLimitStage } from 'src/core/security/rate-limiting/rate-limit-stage';
import { RateLimitStageRunner } from 'src/core/security/rate-limiting/rate-limit-stage.runner';
import { RateLimitTrackerSource } from 'src/core/security/rate-limiting/rate-limit-tracker-source';
import { DependencyUnavailableException, RateLimitedException } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

/**
 * Builds the executor with observable port boundaries and real policy metadata.
 *
 * @returns Runner, request context and dependency spies.
 */
function setup() {
    const handler = () => undefined;
    Reflect.defineMetadata(KEY_DECORATOR_RATE_LIMIT, RateLimitPolicy.DEFAULT, handler);
    const request = { ip: '192.0.2.1', body: { email: 'user@example.test' } };
    const context = {
        getHandler: () => handler,
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const resolve = vi.fn(() => '192.0.2.1');
    const consume = vi.fn<IRateLimitCounterPort['consume']>().mockResolvedValue({ allowed: true });
    const runner = new RateLimitStageRunner(
        new Reflector(),
        {
            [RateLimitTrackerSource.IP]: { resolve },
            [RateLimitTrackerSource.TARGET_ACCOUNT]: new TargetAccountTrackerResolverAdapter(),
        },
        { consume },
        new ConfigService({ SERVICE_NAME: 'api' }),
    );
    return { runner, context, handler, consume, resolve, request };
}

describe('RateLimitStageRunner', () => {
    it('uses policy-scoped shared keys and preserves declared counter order', async () => {
        const { runner, context, consume } = setup();
        await expect(runner.run(context, RateLimitStage.PRE_AUTH)).resolves.toBe(true);
        expect(consume.mock.calls.map(([attempt]) => attempt.key)).toEqual([
            'api:rl:default:ip-short:192.0.2.1',
            'api:rl:default:ip-long:192.0.2.1',
        ]);
        expect(consume.mock.calls[0]?.[0]).toMatchObject({
            limiterName: 'ip-short',
            limit: 600,
            windowSeconds: 60,
            blockDurationSeconds: 10,
        });
    });

    it('skips exempt handlers and stages without applicable counters', async () => {
        const { runner, context, handler, consume, resolve } = setup();
        await runner.run(context, RateLimitStage.POST_AUTH);
        Reflect.defineMetadata(KEY_DECORATOR_RATE_LIMIT_EXEMPT, true, handler);
        await runner.run(context, RateLimitStage.PRE_AUTH);
        expect(resolve).not.toHaveBeenCalled();
        expect(consume).not.toHaveBeenCalled();
    });

    it('stops on the first block and preserves its retry delay', async () => {
        const { runner, context, consume } = setup();
        consume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 7 });
        await expect(runner.run(context, RateLimitStage.PRE_AUTH)).rejects.toMatchObject({
            kind: 'RATE_LIMITED',
            retryAfterSeconds: 7,
        });
        expect(consume).toHaveBeenCalledTimes(1);
    });

    it.each([new DependencyUnavailableException(), new Error('unexpected store failure')])(
        'propagates storage failures without consuming subsequent counters',
        async (error) => {
            const { runner, context, consume } = setup();
            consume.mockRejectedValueOnce(error);
            await expect(runner.run(context, RateLimitStage.PRE_AUTH)).rejects.toBe(error);
            expect(consume).toHaveBeenCalledTimes(1);
        },
    );

    it('does not undo the first consumption when the second counter blocks', async () => {
        const { runner, context, consume } = setup();
        consume
            .mockResolvedValueOnce({ allowed: true })
            .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });
        await expect(runner.run(context, RateLimitStage.PRE_AUTH)).rejects.toBeInstanceOf(RateLimitedException);
        expect(consume).toHaveBeenCalledTimes(2);
    });

    it('rejects an empty tracker before storage access', async () => {
        const { runner, context, resolve, consume } = setup();
        resolve.mockReturnValue('');
        await expect(runner.run(context, RateLimitStage.PRE_AUTH)).rejects.toThrow('invalid tracker');
        expect(consume).not.toHaveBeenCalled();
    });
    it.each([RateLimitPolicy.USER_LOGIN, RateLimitPolicy.ADMIN_LOGIN, RateLimitPolicy.USER_ACTIVATION_RESEND])(
        'executes %s IP counters before both shared account counters',
        async (policy) => {
            const { runner, context, handler, consume } = setup();
            Reflect.defineMetadata(KEY_DECORATOR_RATE_LIMIT, policy, handler);
            await expect(runner.run(context, RateLimitStage.PRE_AUTH)).resolves.toBe(true);
            const keys = consume.mock.calls.map(([attempt]) => attempt.key);
            expect(keys).toHaveLength(4);
            expect(keys[0]).toBe(`api:rl:${policy}:ip-short:192.0.2.1`);
            expect(keys[1]).toBe(`api:rl:${policy}:ip-long:192.0.2.1`);
            expect(keys[2]).toMatch(new RegExp(`^api:rl:${policy}:target-account-short:[a-f0-9]{64}$`));
            expect(keys[3]).toBe(keys[2]!.replace('target-account-short', 'target-account-long'));
        },
    );

    it.each([0, 1, 2, 3])('stops before later resolvers and counters when counter %i refuses', async (index) => {
        const { runner, context, handler, consume, request } = setup();
        Reflect.defineMetadata(KEY_DECORATOR_RATE_LIMIT, RateLimitPolicy.USER_LOGIN, handler);
        if (index < 2) {
            // Malformed input must not override an earlier IP block.
            request.body.email = '';
        }
        for (let i = 0; i < index; i++) {
            consume.mockResolvedValueOnce({ allowed: true });
        }
        consume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 17 });
        await expect(runner.run(context, RateLimitStage.PRE_AUTH)).rejects.toMatchObject({
            kind: 'RATE_LIMITED',
            retryAfterSeconds: 17,
        });
        expect(consume).toHaveBeenCalledTimes(index + 1);
    });

    it('consumes only IP counters when the account field is invalid', async () => {
        const { runner, context, handler, consume, request } = setup();
        Reflect.defineMetadata(KEY_DECORATOR_RATE_LIMIT, RateLimitPolicy.USER_LOGIN, handler);
        request.body.email = '';
        await expect(runner.run(context, RateLimitStage.PRE_AUTH)).rejects.toMatchObject({ kind: 'INVALID_INPUT' });
        expect(consume.mock.calls.map(([attempt]) => attempt.limiterName)).toEqual(['ip-short', 'ip-long']);
    });
});
