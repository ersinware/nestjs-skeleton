/**
 * @file password-generator.util.ts
 * @description Utility helper to generate strong, secure random temporary passwords.
 */

import { randomInt } from 'node:crypto';

/**
 * Generates a cryptographically secure, random temporary password.
 * Guarantees at least one uppercase letter, one lowercase letter, one number, and one special character.
 *
 * @param length The total length of the generated password (defaults to 16).
 * @returns The generated strong password.
 */
export function generateSecurePassword(length = 16): string {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        lowercase = 'abcdefghijklmnopqrstuvwxyz',
        numbers = '0123456789',
        specials = '!@#$%^&*()_+~`|}{[]:;?><,./-=',
        allChars = uppercase + lowercase + numbers + specials,
        chars = [
            uppercase[randomInt(uppercase.length)]!,
            lowercase[randomInt(lowercase.length)]!,
            numbers[randomInt(numbers.length)]!,
            specials[randomInt(specials.length)]!,
        ];

    // Fill the remaining length with random characters from the combined set
    while (chars.length < length) {
        chars.push(allChars[randomInt(allChars.length)]!);
    }

    // Shuffle the characters using Fisher-Yates to ensure random placement
    for (let i = chars.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }

    return chars.join('');
}
