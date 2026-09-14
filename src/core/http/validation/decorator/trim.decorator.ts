/**
 * @file trim.decorator.ts
 * @description Opt-in boundary whitespace removal for text fields.
 */

import { Transform } from 'class-transformer';

/**
 * Trims strings when constructing class instances; preserves non-strings for validation.
 * Does not collapse interior whitespace or convert empty strings to missing values.
 *
 * @returns A property transformation for fields whose boundary whitespace is insignificant.
 */
export function Trim(): PropertyDecorator {
    return Transform(
        ({ value }: { readonly value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value),
        {
            toClassOnly: true,
        },
    );
}
