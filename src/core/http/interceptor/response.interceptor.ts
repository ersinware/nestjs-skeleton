/**
 * @file response.interceptor.ts
 * @description Global response interceptor that standardizes successful API responses
 * by wrapping the returned data in a uniform structure ({ data: ... }).
 */

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Interceptor that formats successful outgoing HTTP responses to ensure a consistent response structure.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
    /**
     * Intercepts the response flow of the request.
     * Bypasses modification for status codes that do not return content (e.g., 204 No Content, 304 Not Modified).
     * Maps all other successful responses to a standardized format wrapping the payload.
     *
     * @param context The current execution context of the request.
     * @param handler The call handler facilitating the continuation of the request lifecycle.
     * @returns An observable mapping the output to a structured response object containing the data.
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
