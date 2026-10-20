/**
 * @file user-avatar-change.spec.ts
 * @description Verifies that upload proofs bind exactly the selected identity and submitted profile fields.
 */

/// <reference types="vitest/globals" />

import {
    assertUserAvatarChangeFormHashMatches,
    createUserAvatarChangeFormHash,
} from 'src/module/user/domain/user-avatar-change';
import { ExceptionKind } from 'src/shared/exception';

describe('User avatar form binding', () => {
    const form = { id: 'owner', avatarId: 'avatar', avatar: { sizeBytes: 4, contentType: 'image/png' } } as const;
    const secret = 'server-only-secret';

    it('accepts the exact avatar-only form and combined name', () => {
        for (const input of [form, { ...form, name: 'User Name' }]) {
            expect(() =>
                assertUserAvatarChangeFormHashMatches(input, secret, createUserAvatarChangeFormHash(input, secret)),
            ).not.toThrow();
        }
    });

    it.each([
        { ...form, id: 'other' },
        { ...form, avatarId: 'other' },
        { ...form, name: 'User Name' },
        { ...form, avatar: { ...form.avatar, sizeBytes: 5 } },
        { ...form, avatar: { ...form.avatar, contentType: 'image/jpeg' as const } },
    ])('rejects changes to signed form fields: %j', (changed) => {
        expect(() =>
            assertUserAvatarChangeFormHashMatches(changed, secret, createUserAvatarChangeFormHash(form, secret)),
        ).toThrow(expect.objectContaining({ kind: ExceptionKind.INVALID_INPUT }));
    });

    it('rejects a removed name, wrong secret, and malformed binding', () => {
        expect(() =>
            assertUserAvatarChangeFormHashMatches(
                form,
                secret,
                createUserAvatarChangeFormHash({ ...form, name: 'User Name' }, secret),
            ),
        ).toThrow();
        expect(() =>
            assertUserAvatarChangeFormHashMatches(form, 'other', createUserAvatarChangeFormHash(form, secret)),
        ).toThrow();
        expect(() => assertUserAvatarChangeFormHashMatches(form, secret, '')).toThrow();
    });
});
