/**
 * @file password-generator.util.spec.ts
 * @description Unit tests for the password generator utility.
 */

import { generateSecurePassword } from 'src/core/security/password/password-generator.util';
import { PASSWORD_REGEX, PASSWORD_REQUIRED_CHARSETS } from 'src/core/security/password/password-policy';
import { describe, expect, it } from 'vitest';

describe('passwordGeneratorUtil', () => {
    it('should generate a password of the default length (16)', () => {
        const password = generateSecurePassword();

        expect(password).toBeTypeOf('string');
        expect(password.length).toBe(16);
    });

    it('should generate a password of a custom length', () => {
        const password = generateSecurePassword(24);
        expect(password.length).toBe(24);
    });

    it('should generate a password satisfying the password policy plus a special character', () => {
        // Repeated runs so a randomly missing character class cannot pass by luck
        for (let i = 0; i < 100; i++) {
            const password = generateSecurePassword();

            expect(password).toMatch(PASSWORD_REGEX);

            for (const charset of Object.values(PASSWORD_REQUIRED_CHARSETS)) {
                expect([...password].some((char) => charset.includes(char))).toBe(true);
            }

            // The generator adds one special character on top of the policy
            expect(/[!@#$%^&*()_+~`|}{[\]:;?><,./\-=]/.test(password)).toBe(true);
        }
    });
});
