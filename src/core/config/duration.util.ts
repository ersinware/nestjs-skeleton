/**
 * @file duration.util.ts
 * @description Converts configured duration strings to whole seconds at library boundaries.
 */

/** Seconds in each admitted duration unit. */
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Converts a boot-validated duration to seconds without repeating configuration validation.
 * @param value Boot-validated duration with an s/m/h/d suffix.
 * @returns Duration in seconds.
 */
export function parseTtlToSeconds(value: string): number {
    return Number(value.slice(0, -1)) * UNIT_SECONDS[value.slice(-1)]!;
}
