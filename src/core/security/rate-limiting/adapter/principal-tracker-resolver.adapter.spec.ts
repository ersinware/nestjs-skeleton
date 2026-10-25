/**
 * @file principal-tracker-resolver.adapter.spec.ts
 * @description Verified caller tracking without token, network, session or target-derived fallback.
 */

import type { AuthenticatedRequest } from 'src/core/security/auth';
import { PrincipalTrackerResolverAdapter } from 'src/core/security/rate-limiting/adapter/principal-tracker-resolver.adapter';
import { PrincipalType } from 'src/shared/domain/principal';
import { describe, expect, it } from 'vitest';

describe('PrincipalTrackerResolverAdapter', () => {
    const resolver = new PrincipalTrackerResolverAdapter();

    it.each([PrincipalType.USER, PrincipalType.ADMIN])('uses only the verified %s caller ID', (principalType) => {
        const request = {
            accessTokenPayload: { sub: 'verified-caller', principalType, sid: 'session-a' },
            ip: '192.0.2.1',
            body: { id: 'body-target', email: 'target@example.test' },
            params: { id: 'route-target' },
            headers: { authorization: 'Bearer untrusted' },
        } as unknown as AuthenticatedRequest;
        expect(resolver.resolve(request)).toBe('verified-caller');
        expect(
            resolver.resolve({
                ...request,
                ip: '198.51.100.2',
                accessTokenPayload: { ...request.accessTokenPayload!, sid: 'session-b' },
            }),
        ).toBe('verified-caller');
    });

    it.each([undefined, null, {}, { sub: '' }])('rejects missing verified identity %j without fallback', (payload) => {
        const request = {
            accessTokenPayload: payload,
            ip: '192.0.2.1',
            body: { id: 'body-target' },
            params: { id: 'route-target' },
            headers: { authorization: 'Bearer eyJzdWIiOiJmYWtlIn0' },
        } as unknown as AuthenticatedRequest;
        expect(() => resolver.resolve(request)).toThrow(
            expect.objectContaining({
                kind: 'SYSTEM',
                context: { class: PrincipalTrackerResolverAdapter.name, method: 'resolve' },
            }),
        );
    });
});
