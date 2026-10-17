/**
 * @file avatar-cache-policy.ts
 * @description Shared cache policies for pending uploads and immutable permanent avatars.
 */

/**
 * Prevents caching avatar uploads before their permanent attachment.
 */
export const AVATAR_PENDING_CACHE_POLICY = {
    visibility: 'no-store',
} as const;

/**
 * Allows browsers and shared caches to retain immutable avatar versions for one year.
 */
export const AVATAR_PERMANENT_CACHE_POLICY = {
    visibility: 'public',
    maxAgeSeconds: 31_536_000,
    sharedMaxAgeSeconds: 31_536_000,
    immutable: true,
} as const;
