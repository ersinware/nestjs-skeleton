/**
 * @file password-generator.util.ts
 * @description Generates random temporary passwords satisfying the password policy.
 */

import { randomInt } from 'node:crypto';
import { PASSWORD_REQUIRED_CHARSETS } from 'src/core/security/password/password-policy';

/**
 * Generates a cryptographically secure random password containing at least one character from
 * every policy-required class, plus one special character on top of the policy.
 *
 * @param length Total password length.
 * @returns The generated password.
 */
export function generateSecurePassword(length = 16): string {
    const specials = '!@#$%^&*()_+~`|}{[]:;?><,./-=',
        requiredSets = [...Object.values(PASSWORD_REQUIRED_CHARSETS), specials],
        allChars = requiredSets.join(''),
        chars = requiredSets.map((set) => set[randomInt(set.length)]!);

    while (chars.length < length) {
        chars.push(allChars[randomInt(allChars.length)]!);
    }

    // Fisher-Yates shuffle so the guaranteed characters do not sit at fixed positions
    for (let i = chars.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }

    return chars.join('');
}
