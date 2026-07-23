/**
 * @file audit-context.interceptor.ts
 * @description Global interceptor that publishes the request's actor and transport facts into ambient
 * storage for the duration of the handler, so audit records can be attributed without the handlers
 * ever learning about HTTP.
 */

import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { auditContextStorage, type AuditContext } from 'src/core/observability/audit/audit-context';
import type { AuthenticatedRequest } from 'src/core/security/auth';

/**
 * Establishes the {@link AuditContext} for the current request and writes NOTHING itself.
 *
 * The separation is deliberate: an interceptor sees that a request finished, not what the use case
 * decided, so a record written from here could only ever describe the transport. Deciding an action
 * was auditable stays with the code that established the fact — the handler — and this class's only
 * job is to make sure the actor is already in scope by the time that code runs.
 *
 * It reads the actor from `accessTokenPayload`, which the auth guard has already put on the request;
 * on a `@Public()` route that field is absent and the actor is simply unknown, which is the truth.
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
    /**
     * Runs the rest of the request inside the ambient audit context.
     *
     * The handler is subscribed to INSIDE `run()` rather than merely constructed inside it: an
     * Observable executes on subscription, and Nest subscribes after this method has returned. Doing
     * it any other way would leave the store empty exactly where it is read.
     *
     * @param executionContext The current execution context, used to reach the HTTP request
     * @param next The remainder of the request pipeline
     * @returns The handler's stream, subscribed within the ambient context
     */
    intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
        const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>(),
            context: AuditContext = {
                actorId: request.accessTokenPayload?.sub,
                actorRole: request.accessTokenPayload?.role,
                sourceIp: request.ip,
                userAgent: request.headers['user-agent'],
            };

        return new Observable((subscriber) =>
            auditContextStorage.run(context, () => next.handle().subscribe(subscriber)),
        );
    }
}
