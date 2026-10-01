/**
 * @file user-registration.spec.ts
 * @description Verifies registration form binding rejects changes to every upload-authorized field.
 */

import {
    assertUserRegistrationFormHashMatches,
    createUserRegistrationFormHash,
} from 'src/module/user/domain/user-registration';
import { ExceptionKind } from 'src/shared/exception';

describe('User registration form binding', () => {
    const form = {
        email: 'avatar@example.test',
        name: 'Avatar',
        password: 'Password!123',
        avatar: { sizeBytes: 4, contentType: 'image/png' as const },
    };
    const secret = 'test-upload-secret';

    it('accepts the same normalized form', () => {
        expect(() =>
            assertUserRegistrationFormHashMatches(form, secret, createUserRegistrationFormHash(form, secret)),
        ).not.toThrow();
    });

    it.each([
        { ...form, email: 'other@example.test' },
        { ...form, name: 'Other' },
        { ...form, password: 'OtherPassword!123' },
        { ...form, avatar: { ...form.avatar, sizeBytes: 5 } },
        { ...form, avatar: { ...form.avatar, contentType: 'image/jpeg' as const } },
    ])('rejects a changed authorized form: %s', (changed) => {
        expect(() =>
            assertUserRegistrationFormHashMatches(changed, secret, createUserRegistrationFormHash(form, secret)),
        ).toThrow(expect.objectContaining({ kind: ExceptionKind.INVALID_INPUT }));
    });

    it('rejects another secret and malformed hash lengths', () => {
        for (const hash of [createUserRegistrationFormHash(form, 'other-secret'), 'short']) {
            expect(() => assertUserRegistrationFormHashMatches(form, secret, hash)).toThrow(
                expect.objectContaining({ kind: ExceptionKind.INVALID_INPUT }),
            );
        }
    });
});
