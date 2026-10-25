/**
 * @file target-account-tracker-resolver.adapter.spec.ts
 * @description Raw email extraction, lookup-compatible normalization and invalid-input boundaries.
 */

import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { EMAIL_MAX_LENGTH } from 'src/core/http';
import { TargetAccountTrackerResolverAdapter } from 'src/core/security/rate-limiting/adapter/target-account-tracker-resolver.adapter';
import { RateLimitTrackerField } from 'src/core/security/rate-limiting/rate-limit-policy';
import { InvalidInputException, SystemException } from 'src/shared/exception';
import { describe, expect, it } from 'vitest';

/**
 * Supplies raw transport input without DTO transformation.
 *
 * @param body Untrusted request body.
 * @returns Request carrying only the resolver's input.
 */
function request(body: unknown): FastifyRequest {
    return { body } as FastifyRequest;
}

describe('TargetAccountTrackerResolverAdapter', () => {
    const resolver = new TargetAccountTrackerResolverAdapter();

    it('hashes trimmed email without mutating raw input or including other credentials', () => {
        const body = { email: ' \tUser+alias@example.test\n', password: 'secret' };
        const expected = createHash('sha256').update('User+alias@example.test').digest('hex');
        expect(resolver.resolve(request(body), RateLimitTrackerField.EMAIL)).toBe(expected);
        expect(
            resolver.resolve(request({ email: body.email, password: 'different' }), RateLimitTrackerField.EMAIL),
        ).toBe(expected);
        expect(body.email).toBe(' \tUser+alias@example.test\n');
    });

    it('preserves case and provider aliases because account lookup uses exact email equality', () => {
        const trackers = ['User@example.test', 'user@example.test', 'user+tag@example.test'].map((email) =>
            resolver.resolve(request({ email }), RateLimitTrackerField.EMAIL),
        );
        expect(new Set(trackers).size).toBe(3);
        for (const tracker of trackers) {
            expect(tracker).toMatch(/^[a-f0-9]{64}$/);
        }
    });

    it.each([
        undefined,
        null,
        'email@example.test',
        1,
        [],
        [{ email: 'user@example.test' }],
        {},
        { email: null },
        { email: 1 },
        { email: [] },
        { email: {} },
        { email: '' },
        { email: '   ' },
        { email: 'invalid' },
        { email: 'a@b' },
        { email: `a@${'b'.repeat(EMAIL_MAX_LENGTH)}.test` },
    ])('rejects malformed raw payload %j instead of using an empty or fallback tracker', (body) => {
        expect(() => resolver.resolve(request(body), RateLimitTrackerField.EMAIL)).toThrow(InvalidInputException);
    });

    it.each([undefined, null])('rejects missing server configuration %s with diagnostic context', (field) => {
        try {
            resolver.resolve(request({ email: 'user@example.test' }), field as unknown as RateLimitTrackerField);
            expect.unreachable('Missing configuration must fail');
        } catch (error) {
            expect(error).toBeInstanceOf(SystemException);
            expect(error).toMatchObject({
                context: { class: TargetAccountTrackerResolverAdapter.name, method: 'resolve' },
            });
        }
    });
});
