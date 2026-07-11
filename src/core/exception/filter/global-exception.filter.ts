/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/**
 * @file global-exception.filter.ts
 * @description Global exception filter catching and standardizing HTTP and database errors.
 */

import type { ArgumentsHost } from '@nestjs/common';
import { Catch, ExceptionFilter, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AccessDeniedException } from 'src/core/exception/class/access-denied.exception';
import { InvalidRequestException } from 'src/core/exception/class/invalid-request.exception';
import { ResourceConflictException } from 'src/core/exception/class/resource-conflict.exception';
import { ResourceNotFoundException } from 'src/core/exception/class/resource-not-found.exception';
import { SystemException } from 'src/core/exception/class/system.exception';
import { UnauthenticatedException } from 'src/core/exception/class/unauthenticated.exception';
import { ErrorDefaultDto } from 'src/core/exception/dto/error-default.dto';
import { InternalServerErrorType } from 'src/core/exception/enum/internal-server-error-type.enum';
import { ResourceConflictType } from 'src/core/exception/enum/resource-conflict-type.enum';
import { ResourceNotFoundType } from 'src/core/exception/enum/resource-not-found-type.enum';
import { ServiceUnavailableType } from 'src/core/exception/enum/service-unavailable-type.enum';
import {
    AuditLogAction,
    AuditLogPayload,
    LogPayload,
    TOKEN_EXCEPTION_TRACKER_PORT,
    TOKEN_LOGGER_PORT,
    type IExceptionTrackerPort,
    type ILoggerPort,
} from 'src/core/observability';
import { AuthenticatedRequest } from 'src/core/security';
/**
 * Internal database error payload shape.
 */
interface DatabaseError {
    /** DB error code. */
    code: string;

    /** DB error details. */
    detail?: string;

    /** Affected database column. */
    column?: string;

    /** Raw error message. */
    message?: string;
}

/**
 * Internal wrapper for exceptions caused by nested database errors.
 */
interface WrappedError {
    /** Database error source. */
    cause?: DatabaseError;
}

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
     * which must pass the raw output of the indicator.
     */
    private isHealthCheckUnavailable(exception: unknown, request: { url?: string }): boolean {
        return (
            exception instanceof HttpException &&
            exception.getStatus() === HttpStatus.SERVICE_UNAVAILABLE &&
            (request?.url?.includes('/health') ?? false)
        );
    }

    /**
     * Translates any exception into a normalized standard DTO structure.
     */
    private normalizeException(exception: unknown): ErrorDefaultDto {
        if (exception instanceof HttpException) {
            return this.formatHttpException(exception);
        }

        const customError = this.formatCustomException(exception);
        if (customError) {
            return customError;
        }

        const dbError = this.formatDatabaseException(exception);
        if (dbError) {
            return dbError;
        }

        return this.formatInternalServerError();
    }

    /**
     * Formats and sanitizes custom domain exceptions.
     */
    private formatCustomException(exception: unknown): ErrorDefaultDto | null {
        if (exception instanceof ResourceNotFoundException) {
            return {
                statusCode: HttpStatus.NOT_FOUND,
                message: [exception.message],
                statusText: this.deriveStatusText(HttpStatus.NOT_FOUND, exception.name),
            };
        }
        if (exception instanceof ResourceConflictException) {
            return {
                statusCode: HttpStatus.CONFLICT,
                message: [exception.message],
                statusText: this.deriveStatusText(HttpStatus.CONFLICT, exception.name),
            };
        }
        if (exception instanceof UnauthenticatedException) {
            return {
                statusCode: HttpStatus.UNAUTHORIZED,
                message: [exception.message],
                statusText: this.deriveStatusText(HttpStatus.UNAUTHORIZED, exception.name),
            };
        }
        if (exception instanceof AccessDeniedException) {
            return {
                statusCode: HttpStatus.FORBIDDEN,
                message: [exception.message],
                statusText: this.deriveStatusText(HttpStatus.FORBIDDEN, exception.name),
            };
        }
        if (exception instanceof InvalidRequestException) {
            return {
                statusCode: HttpStatus.BAD_REQUEST,
                message: [exception.message],
                statusText: this.deriveStatusText(HttpStatus.BAD_REQUEST, exception.name),
            };
        }
        if (exception instanceof SystemException) {
            return {
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                message: [exception.message],
                statusText: this.deriveStatusText(HttpStatus.INTERNAL_SERVER_ERROR, exception.name),
            };
        }

        return null;
    }

    /**
     * Formats and sanitizes HTTP-based exceptions.
     */
    private formatHttpException(exception: HttpException): ErrorDefaultDto {
        const statusCode = exception.getStatus();

        let message: string[];

        if (statusCode === HttpStatus.SERVICE_UNAVAILABLE) {
            message = [ServiceUnavailableType.DEFAULT];
        } else if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
            message = [InternalServerErrorType.DEFAULT];
        } else if (statusCode === HttpStatus.NOT_FOUND) {
            message = [ResourceNotFoundType.DEFAULT];
        } else {
            message = this.extractMessages(exception.getResponse(), exception.message);
        }

        return { statusCode, message, statusText: this.deriveStatusText(statusCode, exception.name) };
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
     * Parses and formats Database (PostgreSQL) layer errors.
     */
    private formatDatabaseException(exception: unknown): ErrorDefaultDto | null {
        const error = this.getDatabaseError(exception);

        if (error) {
            switch (error.code) {
                case '23505':
                    return {
                        statusCode: HttpStatus.CONFLICT,
                        message: [this.formatUniqueViolationMessage(error.detail)],
                        statusText: 'Conflict',
                    };
                case '23503':
                    return {
                        statusCode: HttpStatus.CONFLICT,
                        message: [ResourceConflictType.FOREIGN_KEY_VIOLATION],
                        statusText: 'Conflict',
                    };
            }
        }

        return null;
    }

    /**
     * Extracts database error information if the exception originates from database layers.
     */
    private getDatabaseError(exception: unknown): DatabaseError | null {
        if (!exception || typeof exception !== 'object') {
            return null;
        }

        const error = exception as WrappedError & DatabaseError;

        if (typeof error.code === 'string' && error.code.length === 5) {
            return error;
        }

        if (error.cause && typeof error.cause === 'object') {
            const cause = error.cause;
            if (typeof cause.code === 'string' && cause.code.length === 5) {
                return cause;
            }
        }

        return null;
    }

    /**
     * Formats database unique constraint violation error details into user-friendly messages.
     */
    private formatUniqueViolationMessage(detail: unknown): string {
        if (typeof detail === 'string') {
            const match = detail.match(/Key \((.*?)\)=\((.*?)\) already exists/);

            if (match && match.length === 3) {
                const field = match[1];

                if (field === 'email') {
                    return ResourceConflictType.EMAIL_IN_USE;
                }

                return `The ${field} is already in use.`;
            }
        }

        return ResourceConflictType.DEFAULT;
    }

    /**
     * Fallback standard payload for completely unknown or unhandled internal errors.
     */
    private formatInternalServerError(): ErrorDefaultDto {
        return {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: [InternalServerErrorType.DEFAULT],
            statusText: 'Internal Server Error',
        };
    }

    /**
     * Emits audit logs or critical incident logs based on the determined response data.
     */
    private logException(exception: unknown, errorDefaultDto: ErrorDefaultDto, request: AuthenticatedRequest) {
        const cause = exception instanceof Error ? (exception as { cause?: unknown }).cause : undefined;

        if (cause instanceof AuditLogPayload) {
            this.loggerPort.warn(cause);

            return;
        }

        const { statusCode, message } = errorDefaultDto;

        if (
            statusCode === HttpStatus.UNAUTHORIZED ||
            statusCode === HttpStatus.FORBIDDEN ||
            statusCode === HttpStatus.TOO_MANY_REQUESTS
        ) {
            this.loggerPort.warn(this.createSecurityAuditLogPayload(message.join(', ') || 'Unknown error', request));
        } else if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
            this.loggerPort.error(this.createErrorLogPayload(exception));
            this.exceptionTrackerPort.captureException(exception);
        }
    }

    /**
     * Creates an audit log payload for security-related exceptions.
     */
    private createSecurityAuditLogPayload(error: string, request: AuthenticatedRequest): AuditLogPayload {
        return new AuditLogPayload({
            class: this.constructor.name,
            method: this.catch.name,
            action: AuditLogAction.SECURITY_EXCEPTION,
            error,
            sub: request.accessTokenPayload?.sub,
            role: request.accessTokenPayload?.role,
        });
    }

    /**
     * Creates a standard log payload for unhandled internal server errors.
     */
    private createErrorLogPayload(exception: unknown): LogPayload {
        return new LogPayload({
            class: this.constructor.name,
            method: this.catch.name,
            error: exception instanceof Error ? exception : new Error(String(exception)),
        });
    }
}
