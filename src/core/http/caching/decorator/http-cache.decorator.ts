/**
 * @file http-cache.decorator.ts
 * @description Decorator declaring the HTTP cache policy of a GET/HEAD endpoint.
 */

import { applyDecorators, HttpStatus, SetMetadata } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { HttpCachePolicy } from 'src/core/http/caching/http-cache-policy.enum';

/**
 * Metadata key under which the route's cache policy is stored.
 */
export const KEY_DECORATOR_HTTP_CACHE = 'KEY_DECORATOR_HTTP_CACHE';

/**
 * Declares the `Cache-Control` policy of the decorated endpoint's successful response.
 *
 * Required on every GET/HEAD endpoint, forbidden on every other method (their responses get
 * `no-store` automatically). `HttpCacheInterceptor` enforces both with a `SystemException`, so a
 * missing or misplaced decorator fails on the first request instead of leaking an implicit policy.
 *
 * A storing policy also documents the `304` that `httpCacheHook` answers on a matching
 * `If-None-Match`: the policy is what makes the 304 possible, so its decorator is the one place
 * that knows to document it.
 *
 * @param policy The `Cache-Control` value written on the response.
 * @returns A decorator storing the policy as route metadata and documenting its `304`.
 */
export const HttpCache = (policy: HttpCachePolicy) =>
    applyDecorators(
        SetMetadata(KEY_DECORATOR_HTTP_CACHE, policy),
        ...(policy === HttpCachePolicy.NO_STORE
            ? []
            : [
                  ApiResponse({
                      status: HttpStatus.NOT_MODIFIED,
                      description: 'The representation matches the `If-None-Match` validator; no body is sent.',
                  }),
              ]),
    );
