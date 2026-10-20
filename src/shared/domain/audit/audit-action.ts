/**
 * @file audit-action.ts
 * @description Branded action contract shared by audit producers without coupling their vocabularies.
 */

/**
 * Compile-time identity distinguishing declared audit actions from arbitrary strings.
 */
declare const auditActionBrand: unique symbol;

/**
 * Declared event identity accepted when producing audit evidence.
 */
export type AuditAction<T extends string = string> = T & {
    /**
     * Compile-time marker assigned only when declaring an audit action.
     */
    readonly [auditActionBrand]: true;
};

/**
 * Declares an audit event while preserving its literal value and runtime representation.
 *
 * @param value Stable event name owned by the declaring vocabulary
 * @returns Branded event identity with its original literal type
 */
export function defineAuditAction<const T extends string>(value: T): AuditAction<T> {
    return value as AuditAction<T>;
}
