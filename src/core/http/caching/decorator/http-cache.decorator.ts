/**
 * @file http-cache.decorator.ts
 * @description Decorator declaring the HTTP cache policy of a GET/HEAD endpoint.
 */

import { SetMetadata } from '@nestjs/common';
import { HttpCachePolicy } from 'src/core/http/caching/http-cache-policy.enum';

/** Metadata key under which the route's cache policy is stored. */
export const KEY_DECORATOR_HTTP_CACHE = 'KEY_DECORATOR_HTTP_CACHE';

/**
 * Declares the `Cache-Control` policy of the decorated endpoint's successful response.
 *
 * Required on every GET/HEAD endpoint, forbidden on every other method (their responses get
 * `no-store` automatically). `HttpCacheInterceptor` enforces both with a `SystemException`, so a
 * missing or misplaced decorator fails on the first request instead of leaking an implicit policy.
 *
 * @param policy The `Cache-Control` value written on the response.
 * @returns A decorator storing the policy as route metadata.
 */
export const HttpCache = (policy: HttpCachePolicy) => SetMetadata(KEY_DECORATOR_HTTP_CACHE, policy);
