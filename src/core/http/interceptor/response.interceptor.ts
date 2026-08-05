/**
 * @file response.interceptor.ts
 * @description Global interceptor wrapping every successful response body in the uniform `{ data }` envelope.
 */

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Gives every endpoint the same `{ data }` response shape, so clients parse one
 * envelope and handlers never wrap their return values manually.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
    /**
     * Wraps the handler's output in `{ data }`, with a missing payload rendered as `data: null`.
     * Bodyless statuses (204 No Content, 304 Not Modified) pass through untouched — an envelope
     * would put a body on a response that must not carry one.
     *
     * @param context The execution context of the current request.
     * @param handler The handler continuing the request pipeline.
     * @returns An observable emitting the enveloped response body.
     */
    intercept(context: ExecutionContext, handler: CallHandler): Observable<unknown> {
        const response = context.switchToHttp().getResponse<FastifyReply>();

        if (response.statusCode === 204 || response.statusCode === 304) {
            return handler.handle();
        }

        return handler.handle().pipe(
            map((data: unknown) => ({
                data: data ?? null,
            })),
        );
    }
}
