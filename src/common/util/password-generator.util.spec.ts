/**
 * @file password-generator.util.spec.ts
 * @description Unit tests for the password generator utility.
 */

import { describe, expect, it } from 'vitest';
import { generateSecurePassword } from './password-generator.util';

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

    it('should generate a strong password meeting complexity criteria', () => {
        // Run multiple times to ensure randomness consistency
        for (let i = 0; i < 100; i++) {
            const password = generateSecurePassword();

            expect(/[A-Z]/.test(password)).toBe(true);
            expect(/[a-z]/.test(password)).toBe(true);
            expect(/[0-9]/.test(password)).toBe(true);
            expect(/[!@#$%^&*()_+~`|}{[\]:;?><,./\-=]/.test(password)).toBe(true);
        }
    });
});
