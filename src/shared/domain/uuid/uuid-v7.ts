/**
 * @file uuid-v7.ts
 * @description Validates UUID v7 identifiers used by application-owned records.
 */

/**
 * Recognizes a canonical UUID v7 with a valid RFC variant.
 *
 * @param value Identifier to inspect
 * @returns Whether the identifier is a UUID v7
 */
export function isUuidV7(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
