/**
 * @file safe-method.util.ts
 * @description Predicate for the HTTP methods whose responses may be cached.
 */

/**
 * Whether the method is GET or HEAD — the only methods whose responses receive a policy other
 * than `no-store`, an `ETag`, or a `304` (RFC 9110 § 9.2.1).
 *
 * @param method The request method, upper-case.
 * @returns `true` for GET and HEAD.
 */
export function isSafeMethod(method: string): boolean {
    return method === 'GET' || method === 'HEAD';
}
