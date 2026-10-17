/**
 * @file admin-avatar-change.spec.ts
 * @description Verifies that upload proofs bind exactly the selected identity and submitted profile fields.
 */

/// <reference types="vitest/globals" />

import {
    assertAdminAvatarChangeFormHashMatches,
    createAdminAvatarChangeFormHash,
} from 'src/module/admin/domain/admin-avatar-change';
import { ExceptionKind } from 'src/shared/exception';

describe('Admin avatar form binding', () => {
    const form = { id: 'owner', avatarId: 'avatar', avatar: { sizeBytes: 4, contentType: 'image/png' } } as const;
    const secret = 'server-only-secret';

    it('accepts the exact avatar-only form and combined name', () => {
        for (const input of [form, { ...form, name: 'Admin Name' }]) {
            expect(() =>
                assertAdminAvatarChangeFormHashMatches(input, secret, createAdminAvatarChangeFormHash(input, secret)),
            ).not.toThrow();
        }
    });

    it.each([
        { ...form, id: 'other' },
        { ...form, avatarId: 'other' },
        { ...form, name: 'Admin Name' },
        { ...form, avatar: { ...form.avatar, sizeBytes: 5 } },
        { ...form, avatar: { ...form.avatar, contentType: 'image/jpeg' as const } },
    ])('rejects changes to signed form fields: %j', (changed) => {
        expect(() =>
            assertAdminAvatarChangeFormHashMatches(changed, secret, createAdminAvatarChangeFormHash(form, secret)),
        ).toThrow(expect.objectContaining({ kind: ExceptionKind.INVALID_INPUT }));
    });

    it('rejects a removed name, wrong secret, and malformed binding', () => {
        expect(() =>
            assertAdminAvatarChangeFormHashMatches(
                form,
                secret,
                createAdminAvatarChangeFormHash({ ...form, name: 'Admin Name' }, secret),
            ),
        ).toThrow();
        expect(() =>
            assertAdminAvatarChangeFormHashMatches(form, 'other', createAdminAvatarChangeFormHash(form, secret)),
        ).toThrow();
        expect(() => assertAdminAvatarChangeFormHashMatches(form, secret, '')).toThrow();
    });
});
