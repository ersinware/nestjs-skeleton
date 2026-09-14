/**
 * @file auth-policy.spec.ts
 * @description Real-metadata coverage of endpoint policy combinations and malformed declarations.
 */

import { SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import 'reflect-metadata';
import { resolveAuthPolicy, type AuthPolicy } from 'src/core/security/auth/auth-policy';
import { Authenticated, KEY_DECORATOR_AUTHENTICATED } from 'src/core/security/auth/decorator/authenticated.decorator';
import { KEY_DECORATOR_PERMISSIONS, Permissions } from 'src/core/security/auth/decorator/permissions.decorator';
import { KEY_DECORATOR_PRINCIPAL_ONLY, PrincipalOnly } from 'src/core/security/auth/decorator/principal-only.decorator';
import { KEY_DECORATOR_PUBLIC, Public } from 'src/core/security/auth/decorator/public.decorator';
import { PERMISSION_HOLDER, Permission, PrincipalType } from 'src/shared/domain/principal';
import { SystemException } from 'src/shared/exception';
import { describe, expect, it } from 'vitest';

type PolicyDecorator = ClassDecorator & MethodDecorator;

/**
 * Applies real decorators to fresh targets, isolating metadata between test cases.
 * @param classPolicies Controller declarations.
 * @param methodPolicies Endpoint declarations.
 * @returns The resolved endpoint policy.
 */
function resolve(classPolicies: readonly PolicyDecorator[], methodPolicies: readonly PolicyDecorator[]): AuthPolicy {
    class ControllerFixture {
        /** Endpoint whose metadata is under test. */
        endpoint(this: void) {}
    }
    for (const decorator of classPolicies) decorator(ControllerFixture);
    for (const decorator of methodPolicies) {
        decorator(
            ControllerFixture.prototype,
            'endpoint',
            Object.getOwnPropertyDescriptor(ControllerFixture.prototype, 'endpoint')!,
        );
    }
    return resolveAuthPolicy(new Reflector(), ControllerFixture, ControllerFixture.prototype.endpoint);
}

const read = Permission.ADMIN_ACCOUNT_READ,
    ban = Permission.ADMIN_ACCOUNT_BAN;

describe('resolveAuthPolicy', () => {
    it.each([
        ['public', Public(), true, undefined, []],
        ['authenticated', Authenticated(), false, undefined, []],
        ['user', PrincipalOnly(PrincipalType.USER), false, PrincipalType.USER, []],
        ['admin', PrincipalOnly(PrincipalType.ADMIN), false, PrincipalType.ADMIN, []],
        ['permissions', Permissions(read), false, undefined, [read]],
    ] as const)(
        'accepts %s at either declaration level',
        (_name, decorator, publicAccess, principalType, permissions) => {
            const expected = { public: publicAccess, principalType, permissions };
            expect(resolve([decorator], [])).toEqual(expected);
            expect(resolve([], [decorator])).toEqual(expected);
        },
    );

    it('rejects absent policies and identifies the endpoint', () => {
        expect(() => resolve([], [])).toThrow(SystemException);
        expect(() => resolve([], [])).toThrow('ControllerFixture.endpoint');
    });

    it.each([Authenticated(), PrincipalOnly(PrincipalType.ADMIN), Permissions(read)])(
        'rejects public combined with protection in either direction or at the same level',
        (protection) => {
            for (const [controller, method] of [
                [[Public()], [protection]],
                [[protection], [Public()]],
                [[Public(), protection], []],
                [[], [Public(), protection]],
            ] as [PolicyDecorator[], PolicyDecorator[]][]) {
                expect(() => resolve(controller, method)).toThrow(SystemException);
            }
        },
    );

    it.each([PrincipalOnly(PrincipalType.ADMIN), Permissions(read)])(
        'allows narrowing a class authenticated policy but rejects ambiguous authenticated declarations',
        (restriction) => {
            expect(() => resolve([Authenticated()], [restriction])).not.toThrow();
            expect(() => resolve([restriction], [Authenticated()])).toThrow(SystemException);
            expect(() => resolve([Authenticated(), restriction], [])).toThrow(SystemException);
            expect(() => resolve([], [Authenticated(), restriction])).toThrow(SystemException);
        },
    );

    it.each([Public(), Authenticated(), PrincipalOnly(PrincipalType.ADMIN)])(
        'accepts matching declarations at both levels',
        (policy) => {
            expect(() => resolve([policy], [policy])).not.toThrow();
        },
    );

    it('unions and deduplicates class and method permissions without mutating metadata', () => {
        const controller = Permissions(read, ban),
            method = Permissions(ban, Permission.ADMIN_ACCOUNT_INVITE);
        expect(resolve([controller], [method]).permissions).toEqual([read, ban, Permission.ADMIN_ACCOUNT_INVITE]);
        expect(resolve([controller], []).permissions).toEqual([read, ban]);
        expect(resolve([], [method]).permissions).toEqual([ban, Permission.ADMIN_ACCOUNT_INVITE]);
    });

    it.each([PrincipalType.USER, PrincipalType.ADMIN])(
        'rejects opposing principal constraints starting with %s',
        (kind) => {
            expect(() =>
                resolve(
                    [PrincipalOnly(kind)],
                    [PrincipalOnly(kind === PrincipalType.USER ? PrincipalType.ADMIN : PrincipalType.USER)],
                ),
            ).toThrow(SystemException);
        },
    );

    it.each([true, false])('checks principal/permission compatibility across levels: %s', (onClass) => {
        for (const kind of [PrincipalType.USER, PrincipalType.ADMIN]) {
            const principal = PrincipalOnly(kind),
                permission = Permissions(read);
            const action = () => resolve(onClass ? [principal] : [permission], onClass ? [permission] : [principal]);
            if (kind === PrincipalType.ADMIN) expect(action).not.toThrow();
            else expect(action).toThrow(SystemException);
            const sameLevel = () => resolve([], [principal, permission]);
            if (kind === PrincipalType.ADMIN) expect(sameLevel).not.toThrow();
            else expect(sameLevel).toThrow(SystemException);
        }
    });

    it('rejects mixed holders if the catalog gains a USER-held permission', () => {
        // Current catalog is ADMIN-only; simulate a future catalog without changing production values.
        const descriptor = Object.getOwnPropertyDescriptor(PERMISSION_HOLDER, ban)!;
        try {
            Object.defineProperty(PERMISSION_HOLDER, ban, { value: PrincipalType.USER, configurable: true });
            expect(() => resolve([Permissions(read)], [Permissions(ban)])).toThrow(SystemException);
        } finally {
            Object.defineProperty(PERMISSION_HOLDER, ban, descriptor);
        }
    });

    it.each([
        ...[KEY_DECORATOR_PUBLIC, KEY_DECORATOR_AUTHENTICATED].flatMap((key) =>
            [false, null, 'true', 1, {}].map((value) => ({ key, value })),
        ),
        ...[null, '', 'SUPERUSER', 0, {}].map((value) => ({ key: KEY_DECORATOR_PRINCIPAL_ONLY, value })),
        ...[null, [], read, {}, [null], ['unknown'], [read, 'unknown']].map((value) => ({
            key: KEY_DECORATOR_PERMISSIONS,
            value,
        })),
    ])('rejects malformed metadata $key = $value at both levels', ({ key, value }) => {
        const malformed = SetMetadata(key, value);
        expect(() => resolve([malformed], [])).toThrow(SystemException);
        expect(() => resolve([], [malformed])).toThrow(SystemException);
    });

    it('inherits class and handler metadata', () => {
        @Permissions(read)
        class Base {
            /** Inherited endpoint with an additional permission. */
            @Permissions(ban)
            endpoint(this: void) {}
        }
        class Child extends Base {}
        expect(resolveAuthPolicy(new Reflector(), Child, Child.prototype.endpoint).permissions).toEqual([read, ban]);
    });
});
