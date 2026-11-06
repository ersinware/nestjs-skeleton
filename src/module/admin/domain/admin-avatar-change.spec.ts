/**
 * @file admin-avatar-change.spec.ts
 * @description Verifies canonical profile forms retain every upload-authorized field.
 */

/// <reference types="vitest/globals" />

import { canonicalizeAdminAvatarChangeForm } from 'src/module/admin/domain/admin-avatar-change';

describe('Admin avatar form binding', () => {
    const form = { id: 'owner', avatarId: 'avatar', avatar: { sizeBytes: 4, contentType: 'image/png' } } as const;

    it('preserves avatar-only and combined profile forms independently of property insertion order', () => {
        expect(canonicalizeAdminAvatarChangeForm(form)).toBe('["owner","avatar",null,4,"image/png"]');
        expect(canonicalizeAdminAvatarChangeForm({ ...form, name: 'Admin Name' })).toBe(
            canonicalizeAdminAvatarChangeForm({
                name: 'Admin Name',
                avatar: form.avatar,
                avatarId: form.avatarId,
                id: form.id,
            }),
        );
        expect(canonicalizeAdminAvatarChangeForm(form)).not.toBe(
            canonicalizeAdminAvatarChangeForm({ ...form, name: 'Admin Name' }),
        );
    });

    it.each([
        { ...form, id: 'other' },
        { ...form, avatarId: 'other' },
        { ...form, name: 'Admin Name' },
        { ...form, avatar: { ...form.avatar, sizeBytes: 5 } },
        { ...form, avatar: { ...form.avatar, contentType: 'image/jpeg' as const } },
    ])('distinguishes changes to authorized fields: %j', (changed) => {
        expect(canonicalizeAdminAvatarChangeForm(changed)).not.toBe(canonicalizeAdminAvatarChangeForm(form));
    });
});
