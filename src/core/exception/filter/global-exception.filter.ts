/**
 * @file global-exception.filter.ts
 * @description Global exception filter catching and standardizing all unhandled errors into the HTTP error contract.
 */

import type { ArgumentsHost } from '@nestjs/common';
import { Catch, ExceptionFilter, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PATH_HEALTH_READY, PATH_HEALTH_STATUS } from 'src/core/config';
import { ErrorDefaultDto } from 'src/core/exception/dto/error-default.dto';
import { AuditAction, isExceptionAudited, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import {
    DependencyUnavailableMessage,
    ExceptionKind,
    isAppException,
    isRateLimitedException,
    ResourceNotFoundMessage,
    SystemMessage,
} from 'src/shared/exception';

/**
 * The single place the transport-neutral taxonomy meets HTTP. Checked with `satisfies`, so a new
 * `ExceptionKind` without a status fails compilation instead of routing silently.
 */
const KIND_TO_STATUS = {
    [ExceptionKind.RESOURCE_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ExceptionKind.RESOURCE_CONFLICT]: HttpStatus.CONFLICT,
    [ExceptionKind.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
    [ExceptionKind.ACCESS_DENIED]: HttpStatus.FORBIDDEN,
    [ExceptionKind.INVALID_INPUT]: HttpStatus.BAD_REQUEST,
    [ExceptionKind.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
    [ExceptionKind.DEPENDENCY_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
    [ExceptionKind.SYSTEM]: HttpStatus.INTERNAL_SERVER_ERROR,
    [ExceptionKind.TERMINAL_JOB]: HttpStatus.INTERNAL_SERVER_ERROR,
} as const satisfies Readonly<Record<ExceptionKind, HttpStatus>>;

/**
 * The only place the taxonomy meets HTTP: maps every caught value to a status and the
 * `ErrorDefaultDto` body, and decides in one spot what the failure leaves behind (log, Sentry,
 * audit), so throwers throw and nothing else formats or records an error.
 */
@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
    /**
     * Connects HTTP error responses to reporting and refusal audit persistence.
     *
     * @param httpAdapterHost Exposes the Fastify adapter the filter replies through.
     * @param errorReporterPort Logs and tracks the failures this filter selects.
     * @param auditPort Writes the audit records for the refusals the transport itself establishes.
     */
    constructor(
        private readonly httpAdapterHost: HttpAdapterHost,
        @Inject(TOKEN_ERROR_REPORTER_PORT) private readonly errorReporterPort: IErrorReporterPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Handles every exception reaching the transport: a health-probe 503 leaves unnormalized,
     * everything else is normalized into the error body, recorded, and replied.
     *
     * @param exception The caught value, of any type.
     * @param host The execution context of the failing request.
     */
    async catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp(),
            response = ctx.getResponse<unknown>(),
            healthProbePassthrough = this.resolveHealthProbePassthrough(
                exception,
                ctx.getRequest<{ readonly url?: string }>(),
            );

        if (healthProbePassthrough) {
            this.httpAdapterHost.httpAdapter.reply(
                response,
                healthProbePassthrough.body,
                HttpStatus.SERVICE_UNAVAILABLE,
            );

            return;
        }

        const errorDefaultDto = this.normalizeException(exception);

        await this.logException(exception, errorDefaultDto);

        if (isRateLimitedException(exception)) {
            this.httpAdapterHost.httpAdapter.setHeader(response, 'Retry-After', String(exception.retryAfterSeconds));
        }

        this.httpAdapterHost.httpAdapter.reply(response, { error: errorDefaultDto }, errorDefaultDto.statusCode);
    }

    /**
     * Resolves an intentional health-probe 503 to the body it must leave with: the detailed
     * endpoint passes the raw indicator output through; the unauthenticated readiness probe
     * answers with NO body, since one would disclose the dependency topology to anonymous
     * callers. Matches the exact path (query string stripped), so an unrelated route merely
     * containing "health" can never bypass normalization.
     *
     * @param exception The caught value, of any type.
     * @param request.url Request URL used to identify exact health-probe paths.
     * @returns The passthrough reply (its body, if any), or null when this is not a health-probe 503.
     */
    private resolveHealthProbePassthrough(
        exception: unknown,
        request: {
            readonly url?: string;
        },
    ): {
        readonly body?: unknown;
    } | null {
        if (!(exception instanceof HttpException)) {
            return null;
        }

        const statusCode: HttpStatus = exception.getStatus();
        if (statusCode !== HttpStatus.SERVICE_UNAVAILABLE) {
            return null;
        }

        const path = request.url?.split('?')[0];

        if (path === PATH_HEALTH_READY) {
            return {};
        }

        if (path === PATH_HEALTH_STATUS) {
            return { body: { error: exception.getResponse() } };
        }

        return null;
    }

    /**
     * Translates any caught value into the standard error DTO; anything unrecognized falls back to
     * a masked 500, the intended outcome for the unexpected.
     *
     * @param exception The caught value, of any type.
     * @returns The error DTO carrying the status and client-facing message.
     */
    private normalizeException(exception: unknown): ErrorDefaultDto {
        if (exception instanceof HttpException) {
            return this.formatHttpException(exception);
        }

        const appException = this.formatAppException(exception);
        if (appException) {
            return appException;
        }

        return new ErrorDefaultDto({
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: [SystemMessage.DEFAULT],
            statusText: 'Internal Server Error',
        });
    }

    /**
     * Formats a framework-raised HTTP exception: 404 and 5xx messages use their shared defaults;
     * other client-facing messages pass through untouched.
     *
     * @param exception The framework exception to format.
     * @returns The error DTO carrying the status and client-facing message.
     */
    private formatHttpException(exception: HttpException): ErrorDefaultDto {
        const statusCode: HttpStatus = exception.getStatus();

        return new ErrorDefaultDto({
            statusCode,
            message: this.getDefaultMessage(statusCode) ??
                this.extractMessages(exception.getResponse()) ?? [exception.message],
            statusText: this.deriveStatusText(statusCode, exception.name),
        });
    }

    /**
     * Resolves the mandatory shared client-facing message for 404 and 5xx statuses. Internal
     * failures may name infrastructure and code paths, which belong only in logs and Sentry;
     * router 404 messages disclose the missing route.
     *
     * @param statusCode The HTTP status the reply will carry.
     * @returns The shared message, or null when the thrower's own client-safe message applies.
     */
    private getDefaultMessage(statusCode: HttpStatus): readonly string[] | null {
        if (statusCode === HttpStatus.SERVICE_UNAVAILABLE) {
            return [DependencyUnavailableMessage.DEFAULT];
        }

        if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
            return [SystemMessage.DEFAULT];
        }

        if (statusCode === HttpStatus.NOT_FOUND) {
            return [ResourceNotFoundMessage.DEFAULT];
        }

        return null;
    }

    /**
     * Extracts the message strings from a framework exception's response body, which may be a bare
     * string or an object carrying `message` as a string or an array (Nest's validation shape).
     *
     * @param response The exception's response body.
     * @returns The extracted messages, or null when the body carries none in a known shape.
     */
    private extractMessages(response: string | object): readonly string[] | null {
        if (typeof response === 'string') {
            return [response];
        }

        if (response !== null) {
            const message = (response as Record<string, unknown>)['message'];

            if (Array.isArray(message)) {
                return message.map(String);
            }

            if (typeof message === 'string') {
                return [message];
            }
        }

        return null;
    }

    /**
     * Translates a taxonomy exception's transport-neutral kind into its HTTP status via
     * `KIND_TO_STATUS`. A taxonomy 5xx carries a diagnostic message for the log and Sentry; the
     * client sees the generic one like any other 5xx.
     *
     * @param exception The caught value, of any type.
     * @returns The error DTO, or null when the value is not a taxonomy exception.
     */
    private formatAppException(exception: unknown): ErrorDefaultDto | null {
        if (!isAppException(exception)) {
            return null;
        }

        const statusCode = KIND_TO_STATUS[exception.kind];

        return new ErrorDefaultDto({
            statusCode,
            message: this.getDefaultMessage(statusCode) ?? [exception.message],
            statusText: this.deriveStatusText(
                statusCode,
                'name' in exception && typeof exception.name === 'string' ? exception.name : 'Error',
            ),
        });
    }

    /**
     * Derives the human-readable status text from the status code, falling back to the supplied
     * exception label for a code `HttpStatus` does not name.
     *
     * @param statusCode The HTTP status the reply will carry.
     * @param exceptionLabel The verified exception name or default label, used only for a non-standard code.
     * @returns The title-cased status text (e.g. `Not Found`).
     */
    private deriveStatusText(statusCode: HttpStatus, exceptionLabel: string): string {
        const statusText = HttpStatus[statusCode];
        if (typeof statusText === 'string') {
            return statusText
                .toLowerCase()
                .replace(/_/g, ' ')
                .split(' ')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }

        return exceptionLabel.replace(/([A-Z])/g, ' $1').trim();
    }

    /**
     * Decides what a caught exception leaves behind; the order is load-bearing:
     *
     * - `503` is silent — per-request logging during an outage is flood; the one breadcrumb is
     *   the connection-level state-transition log.
     * - `>= 500` takes the error log plus a Sentry capture — the only path reading the thrower's
     *   `context` — and is checked first so a `SystemException` cannot degrade into a mere audit
     *   record.
     * - Below `500` only an unaudited `403` is audited: classifying via an opaque
     *   `context` would encode a thrower's vocabulary into core. No `warn` branch — nothing below
     *   500 carries context to log.
     *
     * No `targetId` is passed: the actor is already in the ambient audit context, and naming the
     * same principal again would file the refusal's subject as its object.
     *
     * A failed audit write re-enters this decision (silent on an outage, error log + Sentry
     * otherwise) and never changes the reply: the filter must not throw, so the 403 stands.
     *
     * @param exception The caught value, of any type.
     * @param errorDefaultDto The normalized error the decision keys off.
     */
    private async logException(exception: unknown, errorDefaultDto: ErrorDefaultDto) {
        const { statusCode, message } = errorDefaultDto;

        if (statusCode === HttpStatus.SERVICE_UNAVAILABLE) {
            return;
        }

        if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
            this.errorReporterPort.report(exception, {
                class: this.constructor.name,
                method: this.catch.name,
            });

            return;
        }

        if (statusCode === HttpStatus.FORBIDDEN && !isExceptionAudited(exception)) {
            try {
                await this.auditPort.record({ action: AuditAction.ACCESS_DENIED, reason: message.join(', ') });
            } catch (error) {
                await this.logException(error, this.normalizeException(error));
            }
        }
    }
}
