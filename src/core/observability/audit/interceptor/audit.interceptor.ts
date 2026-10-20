/**
 * @file audit.interceptor.ts
 * @description Global interceptor recording an audit entry for endpoints marked with `@Audited`.
 */

import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, concatMap } from 'rxjs';
import { PARAM_ID } from 'src/core/http';
import { KEY_DECORATOR_AUDITED } from 'src/core/observability/audit/decorator/audited.decorator';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit/port/audit.port';
import type { AuditAction } from 'src/shared/domain/audit';

/**
 * Records an audit entry for handlers annotated with {@link Audited}; does nothing for the rest.
 *
 * Exists for disclosure-only endpoints, where no command handler writes a record. Only the
 * subject — the `:id` route parameter — is read here; actor, transport and trace come from the
 * ambient context.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
    /**
     * Creates an instance of AuditInterceptor.
     *
     * @param reflector Reads the `@Audited` metadata off the matched route.
     * @param auditPort The port the disclosure record is written through.
     */
    constructor(
        private readonly reflector: Reflector,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Writes the audited action once the handler has produced a result, before it is emitted to
     * the client. `concatMap` rather than `tap` sequences the write ahead of the response, so a
     * body is never delivered without its record and a failed write fails the response. A throwing
     * handler produces no entry: nothing was disclosed.
     *
     * @param context The current execution context, used to read the route's audit metadata.
     * @param next The remainder of the request pipeline.
     * @returns The handler's stream, with the audit write sequenced before each emitted value.
     * @throws {DependencyUnavailableException} Through the returned stream when audit persistence is unavailable
     */
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const action = this.reflector.getAllAndOverride<AuditAction>(KEY_DECORATOR_AUDITED, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!action) {
            return next.handle();
        }

        // On a self-scoped route (`me/...`) `:id` is absent and the ambient actor is the subject.
        const targetId = context
            .switchToHttp()
            .getRequest<{ readonly params: Readonly<Record<string, string | undefined>> }>().params[PARAM_ID];

        return next.handle().pipe(
            concatMap(async (data: unknown) => {
                await this.auditPort.record({ action, ...(targetId && { targetId }) });

                return data;
            }),
        );
    }
}
