/**
 * @file user-avatar-change.spec.ts
 * @description Verifies canonical profile forms retain every upload-authorized field.
 */

/// <reference types="vitest/globals" />

import { canonicalizeUserAvatarChangeForm } from 'src/module/user/domain/user-avatar-change';

describe('User avatar form binding', () => {
    const form = { id: 'owner', avatarId: 'avatar', avatar: { sizeBytes: 4, contentType: 'image/png' } } as const;

    it('preserves avatar-only and combined profile forms independently of property insertion order', () => {
        expect(canonicalizeUserAvatarChangeForm(form)).toBe('["owner","avatar",null,4,"image/png"]');
        expect(canonicalizeUserAvatarChangeForm({ ...form, name: 'User Name' })).toBe(
            canonicalizeUserAvatarChangeForm({
                name: 'User Name',
                avatar: form.avatar,
                avatarId: form.avatarId,
                id: form.id,
            }),
        );
        expect(canonicalizeUserAvatarChangeForm(form)).not.toBe(
            canonicalizeUserAvatarChangeForm({ ...form, name: 'User Name' }),
        );
    });

    it.each([
        { ...form, id: 'other' },
        { ...form, avatarId: 'other' },
        { ...form, name: 'User Name' },
        { ...form, avatar: { ...form.avatar, sizeBytes: 5 } },
        { ...form, avatar: { ...form.avatar, contentType: 'image/jpeg' as const } },
    ])('distinguishes changes to authorized fields: %j', (changed) => {
        expect(canonicalizeUserAvatarChangeForm(changed)).not.toBe(canonicalizeUserAvatarChangeForm(form));
    });
});
