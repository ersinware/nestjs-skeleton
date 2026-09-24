/**
 * @file http-cache.interceptor.ts
 * @description Global interceptor writing `Cache-Control` from the route's `@HttpCache` policy.
 */

import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { KEY_DECORATOR_HTTP_CACHE } from 'src/core/http/caching/decorator/http-cache.decorator';
import { HEADER_CACHE_CONTROL, HttpCachePolicy } from 'src/core/http/caching/http-cache-policy.enum';
import { isSafeMethod } from 'src/core/http/caching/safe-method.util';
import { SystemException } from 'src/shared/exception';

/**
 * The policy half of HTTP caching: writes `Cache-Control` from route metadata, which only the
 * `Reflector` can read. The validator half (`ETag` / `304`) is `httpCacheHook`, which needs the
 * serialized body. The header is set before the handler runs; the hook downgrades error replies
 * to `no-store`.
 */
@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
    /**
     * Reads explicit route cache policies through the shared reflector.
     *
     * @param reflector Reads the `@HttpCache` metadata off the matched route.
     */
    constructor(private readonly reflector: Reflector) {}

    /**
     * Writes the declared policy on GET/HEAD and `no-store` on every other method.
     *
     * @param context The current execution context.
     * @param next The remainder of the request pipeline.
     * @returns The handler's stream, unchanged.
     * @throws {SystemException} A GET/HEAD route without `@HttpCache`, or any other method carrying one.
     */
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const http = context.switchToHttp(),
            request = http.getRequest<FastifyRequest>(),
            response = http.getResponse<FastifyReply>(),
            policy = this.reflector.getAllAndOverride<HttpCachePolicy | undefined>(KEY_DECORATOR_HTTP_CACHE, [
                context.getHandler(),
                context.getClass(),
            ]),
            diagnostic = {
                class: HttpCacheInterceptor.name,
                method: this.intercept.name,
                handler: `${context.getClass().name}.${context.getHandler().name}`,
            };

        if (isSafeMethod(request.method)) {
            if (!policy) {
                throw new SystemException('GET/HEAD route lacks @HttpCache', {
                    context: diagnostic,
                });
            }

            response.header(HEADER_CACHE_CONTROL, policy);
        } else {
            if (policy) {
                throw new SystemException('@HttpCache on a non-GET/HEAD route', {
                    context: diagnostic,
                });
            }

            response.header(HEADER_CACHE_CONTROL, HttpCachePolicy.NO_STORE);
        }

        return next.handle();
    }
}
