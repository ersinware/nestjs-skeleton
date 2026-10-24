/**
 * @file ip-tracker.resolver.spec.ts
 * @description Canonical full-address tracking without trusting forwarded headers directly.
 */

import type { FastifyRequest } from 'fastify';
import { IpTrackerResolver } from 'src/core/security/rate-limiting/ip-tracker.resolver';
import { describe, expect, it } from 'vitest';

describe('IpTrackerResolver', () => {
    const resolver = new IpTrackerResolver();

    it.each([
        ['192.0.2.1', '192.0.2.1'],
        ['::ffff:192.0.2.1', '192.0.2.1'],
        ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
        ['2001:db8::2', '2001:db8::2'],
    ])('canonicalizes %s to %s without grouping IPv6 addresses', (ip, expected) => {
        expect(
            resolver.resolve({ ip, headers: { 'x-forwarded-for': '198.51.100.1' } } as unknown as FastifyRequest),
        ).toBe(expected);
    });

    it.each(['', 'invalid', '192.0.2.1, 198.51.100.1'])(
        'rejects invalid adapter IP %s without a header fallback',
        (ip) => {
            expect(() =>
                resolver.resolve({ ip, headers: { 'x-forwarded-for': '198.51.100.1' } } as unknown as FastifyRequest),
            ).toThrow('valid rate-limit IP');
        },
    );
});
