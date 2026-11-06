/**
 * @file target-account-tracker-resolver.adapter.spec.ts
 * @description Raw email extraction, lookup-compatible normalization and invalid-input boundaries.
 */

import type { FastifyRequest } from 'fastify';
import { EMAIL_MAX_LENGTH } from 'src/core/http';
import type { IHashingPort } from 'src/core/security/hashing';
import { TargetAccountTrackerResolverAdapter } from 'src/core/security/rate-limiting/adapter/target-account-tracker-resolver.adapter';
import { RateLimitTrackerField } from 'src/core/security/rate-limiting/rate-limit-policy';
import { InvalidInputException, SystemException } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

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
    const hmacSha256 = vi.fn<IHashingPort['hmacSha256']>();
    const resolver = new TargetAccountTrackerResolverAdapter({ hmacSha256 } as unknown as IHashingPort);

    it('hashes trimmed email without mutating raw input or including other credentials', () => {
        const body = { email: ' \tUser+alias@example.test\n', password: 'secret' };
        const expected = 'a'.repeat(64);
        hmacSha256.mockReturnValue(expected);
        expect(resolver.resolve(request(body), RateLimitTrackerField.TARGET_EMAIL)).toBe(expected);
        expect(
            resolver.resolve(request({ email: body.email, password: 'different' }), RateLimitTrackerField.TARGET_EMAIL),
        ).toBe(expected);
        expect(hmacSha256).toHaveBeenCalledTimes(2);
        expect(hmacSha256).toHaveBeenNthCalledWith(1, 'rate-limit-target-email', 'User+alias@example.test');
        expect(hmacSha256).toHaveBeenNthCalledWith(2, 'rate-limit-target-email', 'User+alias@example.test');
        expect(body.email).toBe(' \tUser+alias@example.test\n');
    });

    it('preserves case and provider aliases because account lookup uses exact email equality', () => {
        hmacSha256
            .mockReturnValueOnce('a'.repeat(64))
            .mockReturnValueOnce('b'.repeat(64))
            .mockReturnValueOnce('c'.repeat(64));
        const emails = ['User@example.test', 'user@example.test', 'user+tag@example.test'];
        const trackers = emails.map((email) =>
            resolver.resolve(request({ email }), RateLimitTrackerField.TARGET_EMAIL),
        );
        expect(new Set(trackers).size).toBe(3);
        expect(hmacSha256.mock.calls).toEqual(emails.map((email) => ['rate-limit-target-email', email]));
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
        expect(() => resolver.resolve(request(body), RateLimitTrackerField.TARGET_EMAIL)).toThrow(
            InvalidInputException,
        );
    });

    it('canonicalizes UUID v7 without changing the raw route parameter', () => {
        const id = '019A1234-ABCD-7DEF-8ABC-123456789ABC';
        const params = { id };
        expect(resolver.resolve({ params } as unknown as FastifyRequest, RateLimitTrackerField.TARGET_ID)).toBe(
            id.toLowerCase(),
        );
        expect(params.id).toBe(id);
    });

    it.each([
        undefined,
        null,
        [],
        'id',
        {},
        { id: 1 },
        { id: '' },
        { id: '550e8400-e29b-41d4-a716-446655440000' },
        { id: '019a1234-abcd-7def-8abc-123456789abc ' },
    ])('rejects invalid target route parameters %j before counter access', (params) => {
        expect(() =>
            resolver.resolve({ params } as unknown as FastifyRequest, RateLimitTrackerField.TARGET_ID),
        ).toThrow(InvalidInputException);
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
