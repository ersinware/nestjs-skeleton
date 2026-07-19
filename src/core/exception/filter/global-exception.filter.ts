/**
 * @file global-exception.filter.ts
 * @description Global exception filter catching and standardizing all unhandled errors into the HTTP error contract.
 */

import type { ArgumentsHost } from '@nestjs/common';
import { Catch, ExceptionFilter, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PATH_HEALTH } from 'src/core/config';
import { ErrorDefaultDto } from 'src/core/exception/dto/error-default.dto';
import {
    AuditLogAction,
    AuditLogPayload,
    LogPayload,
    TOKEN_LOGGER_PORT,
    type ILoggerPort,
} from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/tracker';
import type { AuthenticatedRequest } from 'src/core/security/auth';
import {
    AppException,
    DependencyUnavailableMessage,
    ExceptionKind,
    ResourceNotFoundMessage,
    SystemMessage,
    type ExceptionContext,
} from 'src/shared/exception';

/**
 * The single place the transport-neutral exception taxonomy meets HTTP. Typed as an exhaustive
 * Record so adding an ExceptionKind without deciding its HTTP status fails compilation instead of
 * falling through to a silent default at runtime.
 */
const KIND_TO_STATUS: Record<ExceptionKind, HttpStatus> = {
    [ExceptionKind.NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ExceptionKind.CONFLICT]: HttpStatus.CONFLICT,
    [ExceptionKind.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
    [ExceptionKind.ACCESS_DENIED]: HttpStatus.FORBIDDEN,
    [ExceptionKind.INVALID_INPUT]: HttpStatus.BAD_REQUEST,
    [ExceptionKind.DEPENDENCY_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
    [ExceptionKind.INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
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
     * @param logger Injection of pino logger service.
     */
    constructor(
        private readonly httpAdapterHost: HttpAdapterHost,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
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

        if (this.isHealthCheckUnavailable(exception, ctx.getRequest<{ url?: string }>())) {
            const httpException = exception as HttpException;

            this.httpAdapterHost.httpAdapter.reply(
                response,
                { error: httpException.getResponse() },
                httpException.getStatus(),
            );

            return;
        }

        const errorDefaultDto = this.normalizeException(exception);

        this.logException(exception, errorDefaultDto, ctx.getRequest<AuthenticatedRequest>());
        this.httpAdapterHost.httpAdapter.reply(response, { error: errorDefaultDto }, errorDefaultDto.statusCode);
    }

    /**
     * Identifies if the exception is an intentional 503 response from health checks,
     * which must pass the raw output of the indicator. The URL is matched against the exact
     * health-endpoint path (query string stripped) so an unrelated route merely containing
     * "health" in its path or query can never bypass response normalization.
     */
    private isHealthCheckUnavailable(exception: unknown, request: { url?: string }): boolean {
        if (!(exception instanceof HttpException)) {
            return false;
        }

        const statusCode: HttpStatus = exception.getStatus();

        return statusCode === HttpStatus.SERVICE_UNAVAILABLE && request?.url?.split('?')[0] === PATH_HEALTH;
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
     * Emits audit logs or critical incident logs based on the determined response data.
     *
     * A transient `503` (dependency outage) is deliberately silent here: per-request logging during an
     * outage is pure flood, and detection is the health-endpoint alarm's job; the single
     * forensic breadcrumb is the connection-level
     * state-transition log in `core/cache/module.ts`. Routine `401`s (expired/missing token) are equally
     * uninteresting, so of the context-free statuses only `403` (privilege escalation) and `429`
     * (throttle) remain security-audit worthy.
     *
     * An `ExceptionContext` means "this rejection was deliberate and I have detail on it", so ANY
     * non-5xx status carrying context is recorded — a guard refusing an expired token attaches nothing
     * and stays silent. Recorded is not the same as security-audited, though: the SECURITY_EXCEPTION
     * action is stamped only on the genuinely security-relevant statuses (`403`, `429`, and a `401`
     * whose thrower attached context); any other context-carrying rejection gets a plain `warn`
     * without the action, so filtering the audit trail by action never surfaces non-security noise.
     * Either way the context is carried verbatim under its own key, never merged or read, so the
     * filter stays ignorant of the thrower's vocabulary. The 5xx branch is checked first so a
     * `SystemException` carrying context still reaches the error log and Sentry rather than degrading
     * to a `warn`.
     */
    private logException(exception: unknown, errorDefaultDto: ErrorDefaultDto, request: AuthenticatedRequest) {
        const { statusCode, message } = errorDefaultDto,
            context = exception instanceof AppException ? exception.context : undefined;

        if (statusCode === HttpStatus.SERVICE_UNAVAILABLE) {
            return;
        }

        if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
            this.loggerPort.error(this.createErrorLogPayload(exception, context));
            this.exceptionTrackerPort.captureException(exception);

            return;
        }

        const isSecurityAudited =
            statusCode === HttpStatus.FORBIDDEN ||
            statusCode === HttpStatus.TOO_MANY_REQUESTS ||
            (statusCode === HttpStatus.UNAUTHORIZED && context !== undefined);

        if (isSecurityAudited) {
            this.loggerPort.warn(this.createSecurityAuditLogPayload(message.join(', '), request, context));
        } else if (context !== undefined) {
            this.loggerPort.warn(this.createRejectionLogPayload(message.join(', '), request, context));
        }
    }

    /**
     * Creates an audit log payload for security-related exceptions.
     */
    private createSecurityAuditLogPayload(
        error: string,
        request: AuthenticatedRequest,
        context?: ExceptionContext,
    ): AuditLogPayload {
        return new AuditLogPayload({
            class: this.constructor.name,
            method: this.catch.name,
            action: AuditLogAction.SECURITY_EXCEPTION,
            error,
            sub: request.accessTokenPayload?.sub,
            role: request.accessTokenPayload?.role,
            context,
        });
    }

    /**
     * Creates the plain log payload for a deliberate, context-carrying rejection that is not a
     * security event — the thrower asked for its detail to be recorded, but stamping it with a
     * security action would pollute the audit trail. The caller's identity is still attached for
     * correlation when the route was authenticated.
     */
    private createRejectionLogPayload(
        error: string,
        request: AuthenticatedRequest,
        context: ExceptionContext,
    ): LogPayload {
        return new LogPayload({
            class: this.constructor.name,
            method: this.catch.name,
            error,
            sub: request.accessTokenPayload?.sub,
            role: request.accessTokenPayload?.role,
            context,
        });
    }

    /**
     * Creates a standard log payload for unhandled internal server errors.
     */
    private createErrorLogPayload(exception: unknown, context?: ExceptionContext): LogPayload {
        return new LogPayload({
            class: this.constructor.name,
            method: this.catch.name,
            error: exception instanceof Error ? exception : new Error(String(exception)),
            context,
        });
    }
}
