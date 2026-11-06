/**
 * @file user-registration.spec.ts
 * @description Verifies canonical registration forms retain every upload-authorized field.
 */

/// <reference types="vitest/globals" />

import { canonicalizeUserRegistrationForm } from 'src/module/user/domain/user-registration';

describe('User registration form binding', () => {
    const form = {
        email: 'avatar@example.test',
        name: 'Avatar',
        password: 'Password!123',
        avatar: { sizeBytes: 4, contentType: 'image/png' as const },
    };

    it('preserves form semantics independently of property order and unrelated command metadata', () => {
        const command = { ...form, idempotencyRequest: { key: 'request', canonicalValue: 'metadata' } };
        expect(canonicalizeUserRegistrationForm(command)).toBe(canonicalizeUserRegistrationForm(form));
        expect(
            canonicalizeUserRegistrationForm({
                avatar: form.avatar,
                password: form.password,
                name: form.name,
                email: form.email,
            }),
        ).toBe('["avatar@example.test","Avatar","Password!123",4,"image/png"]');
    });

    it.each([
        { ...form, email: 'other@example.test' },
        { ...form, name: 'Other' },
        { ...form, password: 'OtherPassword!123' },
        { ...form, avatar: { ...form.avatar, sizeBytes: 5 } },
        { ...form, avatar: { ...form.avatar, contentType: 'image/jpeg' as const } },
    ])('distinguishes a changed authorized form: %j', (changed) => {
        expect(canonicalizeUserRegistrationForm(changed)).not.toBe(canonicalizeUserRegistrationForm(form));
    });
});
