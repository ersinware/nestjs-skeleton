/**
 * @file audit.interceptor.ts
 * @description Global interceptor that records an audit entry for endpoints marked with `@Audited`,
 * used only on read/disclosure endpoints — never on state-mutating ones.
 */

import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, concatMap, of } from 'rxjs';
import type { AuditAction } from 'src/core/observability/audit/audit-action.enum';
import { KEY_DECORATOR_AUDITED } from 'src/core/observability/audit/decorator/audited.decorator';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit/port';
import type { AuthenticatedRequest } from 'src/core/security/auth';

/**
 * Records an audit entry for handlers annotated with {@link Audited}, and does nothing for the rest.
 *
 * This is the read-side counterpart to a command writing its own record: it exists purely for
 * endpoints that disclose data without mutating it, where the audited fact is the disclosure itself
 * and there is no state write to hang the record on. A command endpoint must never rely on it — that
 * is a rule of the {@link Audited} decorator, not something this class can check.
 *
 * The two identities on the record come from different places by nature: the actor — who is looking —
 * is an ambient transport fact the {@link AuditAdapter} fills from the context {@link
 * AuditContextInterceptor} established earlier in the pipeline (hence its earlier registration),
 * while the subject — whose data is looked at — is the `:id` route parameter and is read here. The
 * IP, user agent and trace likewise come from the ambient context, not from this class.
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
     * Writes the audited action once the handler has produced a result, before that result is emitted
     * downstream to the client.
     *
     * The record is sequenced into the stream with `concatMap` rather than run as a `tap` side
     * effect so the write is ordered ahead of the response: a disclosure whose record exists but
     * whose body never reached the client is safe, whereas a body that reached the client with no
     * record is precisely the audit gap this endpoint is annotated to close. Because the record is
     * written from inside the success path, a handler that throws — a 404 on a missing subject, say —
     * produces no entry, which is correct: nothing was disclosed.
     *
     * @param context The current execution context, used to read the route's audit metadata.
     * @param next The remainder of the request pipeline.
     * @returns The handler's stream, with the audit write sequenced before each emitted value.
     */
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const action = this.reflector.getAllAndOverride<AuditAction | undefined>(KEY_DECORATOR_AUDITED, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (action === undefined) {
            return next.handle();
        }

        // The subject of the disclosure is the `:id` route parameter — the app-wide convention every
        // `ParamIdDto` route follows. A self-scoped endpoint (`me/...`) has no such parameter, so the
        // target is absent and the actor from the ambient context is itself the subject.
        // Typed `string` by the route generic, but genuinely absent on a param-less route, so it is
        // held as optional — an unattributed target is the truth there, not an empty string.
        const targetId: string | undefined = context.switchToHttp().getRequest<AuthenticatedRequest>().params['id'];

        return next.handle().pipe(
            concatMap((data) => {
                this.auditPort.record({ action, targetId });

                return of(data);
            }),
        );
    }
}
