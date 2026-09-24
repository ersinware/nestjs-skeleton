/**
 * @file password-policy.ts
 * @description Single source of the password-strength policy, consumed by the password generator
 * and the `IsStrongPassword` decorator so the two cannot drift apart.
 */

/**
 * Minimum accepted password length.
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Maximum accepted password length.
 */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Character classes a password must contain at least one member of.
 */
export const PASSWORD_REQUIRED_CHARSETS = {
    /**
     * Uppercase letters available to the password generator.
     */
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',

    /**
     * Lowercase letters available to the password generator.
     */
    lowercase: 'abcdefghijklmnopqrstuvwxyz',

    /**
     * Digits available to the password generator.
     */
    digits: '0123456789',
} as const;

/**
 * Asserts every required character class and the minimum length, derived from the constants above.
 */
export const PASSWORD_REGEX = new RegExp(`^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{${PASSWORD_MIN_LENGTH},}$`);
