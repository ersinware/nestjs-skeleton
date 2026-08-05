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
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/exception-tracker';
import { TOKEN_LOGGER_PORT, type ILoggerPort, type LogPayload } from 'src/core/observability/logger';
import {
    AppException,
    DependencyUnavailableMessage,
    ExceptionKind,
    ResourceNotFoundMessage,
    SystemMessage,
} from 'src/shared/exception';

/**
 * The single place the transport-neutral taxonomy meets HTTP. Exhaustive, so a new ExceptionKind
 * without a status fails compilation.
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
     * Intercepts every exception, decides its record (log/Sentry/audit), and replies with the
     * standardized error body — or lets a health-probe 503 pass through unnormalized.
     */
    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp(),
            response = ctx.getResponse<unknown>(),
            healthProbePassthrough = this.resolveHealthProbePassthrough(exception, ctx.getRequest<{ url?: string }>());

        if (healthProbePassthrough) {
            this.httpAdapterHost.httpAdapter.reply(
                response,
                healthProbePassthrough.body,
                HttpStatus.SERVICE_UNAVAILABLE,
            );

            return;
        }

        const errorDefaultDto = this.normalizeException(exception);

        this.logException(exception, errorDefaultDto);
        this.httpAdapterHost.httpAdapter.reply(response, { error: errorDefaultDto }, errorDefaultDto.statusCode);
    }

    /**
     * Resolves an intentional health-probe 503 to the body it must leave with: the detailed
     * endpoint passes the raw indicator output through; the unauthenticated readiness probe
     * answers with NO body, since one would disclose the dependency topology to anonymous
     * callers. Matches the exact path (query string stripped), so an unrelated route merely
     * containing "health" can never bypass normalization.
     *
     * @returns The body to reply with, or null when this is not a health-probe 503.
     */
    private resolveHealthProbePassthrough(exception: unknown, request: { url?: string }): { body: unknown } | null {
        if (!(exception instanceof HttpException)) {
            return null;
        }

        const statusCode: HttpStatus = exception.getStatus();
        if (statusCode !== HttpStatus.SERVICE_UNAVAILABLE) {
            return null;
        }

        const path = request.url?.split('?')[0];

        if (path === PATH_HEALTH_READY) {
            return { body: undefined };
        }

        if (path === PATH_HEALTH) {
            return { body: { error: exception.getResponse() } };
        }

        return null;
    }

    /**
     * Translates any caught value into the standard error DTO; anything unrecognized falls back to
     * a masked 500.
     */
    private normalizeException(exception: unknown): ErrorDefaultDto {
        if (exception instanceof HttpException) {
            return this.formatHttpException(exception);
        }

        const appError = this.formatAppException(exception);
        if (appError) {
            return appError;
        }

        return new ErrorDefaultDto({
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: [SystemMessage.DEFAULT],
            statusText: 'Internal Server Error',
        });
    }

    /**
     * Formats framework-raised HTTP exceptions, masking the bodies that would leak internals (a
     * raw 5xx or 503 names infrastructure, the router's 404 names the missing route) with their
     * taxonomy DEFAULT; client-facing 4xx messages pass through untouched.
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
            message = this.extractMessages(exception.getResponse()) ?? [exception.message];
        }

        return new ErrorDefaultDto({
            statusCode,
            message,
            statusText: this.deriveStatusText(statusCode, exception.name),
        });
    }

    /**
     * Extracts the message strings from a standard HTTP exception response body, or null when it
     * carries none in a known shape.
     */
    private extractMessages(response: string | object): string[] | null {
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

        return null;
    }

    /**
     * Translates a taxonomy exception's transport-neutral kind into its HTTP status via
     * KIND_TO_STATUS, or null when the value is not a taxonomy exception.
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
     * Derives a human-readable status text from the status code, falling back to the exception
     * class name for non-standard codes.
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
     * Decides what a caught exception leaves behind; the order is load-bearing:
     *
     * - `503` is silent — per-request logging during an outage is flood; the one breadcrumb is
     *   the connection-level state-transition log.
     * - `>= 500` takes the error log plus a Sentry capture — the only path reading the thrower's
     *   `context` — and is checked first so a `SystemException` cannot degrade into a mere audit
     *   record.
     * - Below `500` only the `403` is audited, by status code alone: classifying via an opaque
     *   `context` would encode a thrower's vocabulary into core. No `warn` branch — nothing below
     *   500 carries context to log.
     *
     * No `targetId` is passed: the actor is already in the ambient audit context, and naming the
     * same principal again would file the refusal's subject as its object.
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
     * Builds the 5xx log payload, attaching the thrower's diagnostic `context` when present.
     */
    private createErrorLogPayload(exception: unknown): LogPayload {
        const error = exception instanceof Error ? exception : new Error(String(exception)),
            context = exception instanceof AppException ? exception.context : undefined;

        return {
            class: this.constructor.name,
            method: this.catch.name,
            message: error.message,
            error,
            ...(context ? { data: { context } } : undefined),
        };
    }
}
