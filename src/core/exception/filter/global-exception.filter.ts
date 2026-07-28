/**
 * @file global-exception.filter.ts
 * @description Global exception filter catching and standardizing all unhandled errors into the HTTP error contract.
 */

import type { ArgumentsHost } from '@nestjs/common';
import { Catch, ExceptionFilter, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PATH_HEALTH, PATH_HEALTH_READY } from 'src/core/config';
import { ErrorDefaultDto } from 'src/core/exception/dto/error-default.dto';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { LogPayload, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/tracker';
import {
    AppException,
    DependencyUnavailableMessage,
    ExceptionKind,
    ResourceNotFoundMessage,
    SystemMessage,
} from 'src/shared/exception';

/**
 * The single place the transport-neutral exception taxonomy meets HTTP. Typed as an exhaustive
 * Record so adding an ExceptionKind without deciding its HTTP status fails compilation instead of
 * falling through to a silent default at runtime.
 */
const KIND_TO_STATUS: Record<ExceptionKind, HttpStatus> = {
    [ExceptionKind.RESOURCE_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ExceptionKind.RESOURCE_CONFLICT]: HttpStatus.CONFLICT,
    [ExceptionKind.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
    [ExceptionKind.ACCESS_DENIED]: HttpStatus.FORBIDDEN,
    [ExceptionKind.INVALID_INPUT]: HttpStatus.BAD_REQUEST,
    [ExceptionKind.DEPENDENCY_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
    [ExceptionKind.SYSTEM]: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * Global exception filter to capture, format, and log all unhandled application errors.
 */
@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
    /**
     * Creates an instance of GlobalExceptionFilter.
     *
     * @param httpAdapterHost Host of the HTTP adapter.
     * @param loggerPort Writes the operational log entries this filter decides to emit.
     * @param auditPort Writes the audit records for the refusals the transport itself establishes.
     * @param exceptionTrackerPort Reports the failures a human must act on.
     */
    constructor(
        private readonly httpAdapterHost: HttpAdapterHost,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        @Inject(TOKEN_EXCEPTION_TRACKER_PORT) private readonly exceptionTrackerPort: IExceptionTrackerPort,
    ) {}

    /**
     * Intercepts and formats exceptions before sending a standardized JSON response.
     *
     * @param exception The caught error.
     * @param host Execution context of the request.
     */
    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp(),
            response = ctx.getResponse<unknown>();

        const healthPassthrough = this.resolveHealthCheckPassthrough(exception, ctx.getRequest<{ url?: string }>());

        if (healthPassthrough !== null) {
            this.httpAdapterHost.httpAdapter.reply(response, healthPassthrough.body, HttpStatus.SERVICE_UNAVAILABLE);

            return;
        }

        const errorDefaultDto = this.normalizeException(exception);

        this.logException(exception, errorDefaultDto);
        this.httpAdapterHost.httpAdapter.reply(response, { error: errorDefaultDto }, errorDefaultDto.statusCode);
    }

    /**
     * Decides whether the exception is an intentional 503 raised by a health probe, and with what
     * body it must leave — the two probes answer different audiences, so one passthrough rule cannot
     * serve both:
     *
     * - The detailed endpoint (operators, super admins) passes the raw indicator output through, so
     *   the failing dependency is named.
     * - The readiness probe (orchestrators) answers with NOTHING. A load balancer branches on the
     *   status code alone, and the probe is unauthenticated: a body there would publish the
     *   infrastructure topology and which dependency is currently down to anyone who asks.
     *
     * URLs are matched against the exact path (query string stripped) so an unrelated route merely
     * containing "health" in its path or query can never bypass response normalization.
     *
     * @param exception The caught error.
     * @param request The incoming request, read for its URL only.
     * @returns The body to reply with, or null when this is not a health-probe 503.
     */
    private resolveHealthCheckPassthrough(exception: unknown, request: { url?: string }): { body: unknown } | null {
        if (!(exception instanceof HttpException)) {
            return null;
        }

        const statusCode: HttpStatus = exception.getStatus();

        if (statusCode !== HttpStatus.SERVICE_UNAVAILABLE) {
            return null;
        }

        const path = request?.url?.split('?')[0];

        if (path === PATH_HEALTH_READY) {
            return { body: undefined };
        }

        if (path === PATH_HEALTH) {
            return { body: { error: exception.getResponse() } };
        }

        return null;
    }

    /**
     * Translates any exception into a normalized standard DTO structure.
     */
    private normalizeException(exception: unknown): ErrorDefaultDto {
        if (exception instanceof HttpException) {
            return this.formatHttpException(exception);
        }

        const appError = this.formatAppException(exception);
        if (appError) {
            return appError;
        }

        return this.formatInternalServerError();
    }

    /**
     * Formats application taxonomy exceptions by translating their transport-neutral kind into the
     * HTTP status vocabulary via the exhaustive KIND_TO_STATUS mapping.
     */
    private formatAppException(exception: unknown): ErrorDefaultDto | null {
        if (!(exception instanceof AppException)) {
            return null;
        }

        const statusCode = KIND_TO_STATUS[exception.kind];

        return new ErrorDefaultDto({
            statusCode,
            message: [exception.message],
            statusText: this.deriveStatusText(statusCode, exception.name),
        });
    }

    /**
     * Formats and sanitizes HTTP-based exceptions.
     */
    private formatHttpException(exception: HttpException): ErrorDefaultDto {
        const statusCode: HttpStatus = exception.getStatus();

        let message: string[];

        if (statusCode === HttpStatus.SERVICE_UNAVAILABLE) {
            message = [DependencyUnavailableMessage.DEFAULT];
        } else if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
            message = [SystemMessage.DEFAULT];
        } else if (statusCode === HttpStatus.NOT_FOUND) {
            message = [ResourceNotFoundMessage.DEFAULT];
        } else {
            message = this.extractMessages(exception.getResponse(), exception.message);
        }

        return new ErrorDefaultDto({
            statusCode,
            message,
            statusText: this.deriveStatusText(statusCode, exception.name),
        });
    }

    /**
     * Extracts array of strings describing the validation or business error from standard responses.
     */
    private extractMessages(response: string | object, fallbackMessage: string): string[] {
        if (typeof response === 'string') {
            return [response];
        }

        if (response !== null && typeof response === 'object') {
            const message = (response as Record<string, unknown>)['message'];

            if (Array.isArray(message)) {
                return message.map(String);
            }

            if (typeof message === 'string') {
                return [message];
            }
        }

        return [fallbackMessage];
    }

    /**
     * Infers a human-readable HTTP status text based on the numeric status code or exception class name.
     */
    private deriveStatusText(statusCode: HttpStatus, exceptionName: string): string {
        const statusText = HttpStatus[statusCode];
        if (typeof statusText === 'string') {
            return statusText
                .toLowerCase()
                .replace(/_/g, ' ')
                .split(' ')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }

        return exceptionName.replace(/([A-Z])/g, ' $1').trim();
    }

    /**
     * Fallback standard payload for completely unknown or unhandled internal errors.
     */
    private formatInternalServerError(): ErrorDefaultDto {
        return new ErrorDefaultDto({
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: [SystemMessage.DEFAULT],
            statusText: 'Internal Server Error',
        });
    }

    /**
     * Decides what a caught exception leaves behind — a Sentry-backed error log, an audit record, or
     * deliberately nothing.
     *
     * A transient `503` (dependency outage) is silent: per-request logging during an outage is pure
     * flood, detection is the health-endpoint alarm's job, and the single forensic breadcrumb is the
     * connection-level state-transition log in `core/cache/module.ts`.
     *
     * Everything `>= 500` is an operational failure a human must act on: it takes the error log plus
     * a Sentry capture, and its `context` — the thrower's diagnostic detail — travels into that log.
     * This is checked before the audit branch so a `SystemException` can never degrade into a mere
     * audit record, and it is the ONLY path on which the filter reads `context` at all.
     *
     * Below `500` the only thing recorded is the `403`, and it is classified by status code alone:
     * "this subject was not allowed through" holds regardless of what the thrower knew. Reaching into
     * an opaque `context` to classify any further would encode the thrower's vocabulary into core, the
     * very coupling the taxonomy exists to prevent. What a refusal MEANT is known to whoever threw it:
     * a 4xx exception is client-facing, so its thrower attaches no `context`, and a thrower with a
     * genuine security fact to record (the auth handlers) writes its own record and stays silent here.
     * There is deliberately no operational `warn` branch — nothing below 500 carries context to log.
     *
     * No identity is passed: the actor reaches the entry through the ambient context, published by
     * `AuthGuard` at the moment it verified the token. Naming the same principal again as `targetId`
     * would file the subject of the refusal as its object.
     */
    private logException(exception: unknown, errorDefaultDto: ErrorDefaultDto) {
        const { statusCode, message } = errorDefaultDto;

        if (statusCode === HttpStatus.SERVICE_UNAVAILABLE) {
            return;
        }

        if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
            this.loggerPort.error(this.createErrorLogPayload(exception));
            this.exceptionTrackerPort.captureException(exception);

            return;
        }

        if (statusCode === HttpStatus.FORBIDDEN) {
            this.auditPort.record({ action: AuditAction.ACCESS_DENIED, reason: message.join(', ') });
        }
    }

    /**
     * Creates the log payload for an unhandled 5xx failure, carrying the thrower's diagnostic
     * `context` when the exception is a taxonomy one — the single path on which `context` is read.
     */
    private createErrorLogPayload(exception: unknown): LogPayload {
        const error = exception instanceof Error ? exception : new Error(String(exception)),
            context = exception instanceof AppException ? exception.context : undefined;

        return new LogPayload({
            class: this.constructor.name,
            method: this.catch.name,
            message: error.message,
            error,
            data: { context },
        });
    }
}
