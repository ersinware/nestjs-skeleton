/**
 * @file global-exception.filter.ts
 * @description Global exception filter catching and standardizing HTTP and database errors.
 */

import { Catch, ExceptionFilter, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { InternalServerErrorType } from 'src/common/enum/error/internal-server-error-type.enum';
import { ConflictType } from 'src/common/enum/error/conflict-type.enum';
import { NotFoundType } from 'src/common/enum/error/not-found-type.enum';
import { ServiceUnavailableType } from 'src/common/enum/error/service-unavailable-type.enum';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';

/**
 * Database error payload shape.
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
 * Wrapper for exceptions caused by nested database errors.
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
        private readonly logger: Logger,
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

        let statusCode: HttpStatus | undefined, messages: string[] | undefined, statusText: string | undefined;

        if (exception instanceof HttpException) {
            // Handle HTTP exceptions originating from NestJS or route handlers
            statusCode = exception.getStatus();

            const resObj = exception.getResponse();

            // Bypass formatting for health check endpoints to preserve the raw probe status only if it is a 503 Service Unavailable
            if (
                statusCode === HttpStatus.SERVICE_UNAVAILABLE &&
                (ctx.getRequest<{ url?: string }>()?.url || '').includes('/health')
            ) {
                this.httpAdapterHost.httpAdapter.reply(
                    response,
                    {
                        error: resObj,
                    },
                    statusCode,
                );

                return;
            }

            // Convert NestJS status code enums to title-case text (e.g., 'BAD_REQUEST' -> 'Bad Request')
            const statusName = HttpStatus[statusCode];
            statusText =
                typeof statusName === 'string'
                    ? statusName
                          .toLowerCase()
                          .replace(/_/g, ' ')
                          .split(' ')
                          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                          .join(' ')
                    : exception.name.replace(/([A-Z])/g, ' $1').trim();

            // Sanitize and map client-facing / server-side messages to prevent leakage of internal details
            if (statusCode === HttpStatus.SERVICE_UNAVAILABLE) {
                messages = [ServiceUnavailableType.DEFAULT];
            } else if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
                messages = [InternalServerErrorType.DEFAULT];
            } else if (statusCode === HttpStatus.NOT_FOUND) {
                messages = [NotFoundType.DEFAULT];
            } else {
                // Extract error message(s) from NestJS ValidationPipe or custom HttpException payloads only when not overridden by default sanitizers
                if (typeof resObj === 'object' && resObj !== null) {
                    const _resObj = resObj as Record<string, unknown>,
                        message = _resObj['message'];

                    if (typeof _resObj['error'] === 'string') {
                        statusText = _resObj['error'];
                    }

                    if (Array.isArray(message)) {
                        messages = message.map((message) => String(message));
                    } else if (typeof message === 'string') {
                        messages = [message];
                    } else {
                        messages = [exception.message];
                    }
                } else if (typeof resObj === 'string') {
                    messages = [resObj];
                } else {
                    messages = [exception.message];
                }
            }
        } else {
            // Parse and map database (PostgreSQL) layer errors
            const _error = this.getDatabaseError(exception);

            if (_error) {
                switch (_error.code) {
                    case '23505': // Unique constraint violation
                        statusCode = HttpStatus.CONFLICT;
                        messages = [this.formatUniqueViolationMessage(_error.detail)];
                        statusText = 'Conflict';

                        break;
                    case '23503': // Foreign key constraint violation
                        statusCode = HttpStatus.CONFLICT;
                        messages = [ConflictType.FOREIGN_KEY_VIOLATION];
                        statusText = 'Conflict';

                        break;
                    default: {
                        // Unhandled database-specific errors
                        this.logger.error(
                            {
                                error: exception instanceof Error ? exception : new Error(String(exception)),
                                class: 'GlobalExceptionFilter',
                                method: 'catch',
                            },
                            'Unhandled database-specific error occurred',
                        );

                        break;
                    }
                }
            } else {
                // Unexpected generic exception
                this.logger.error(
                    {
                        error: exception instanceof Error ? exception : new Error(String(exception)),
                        class: 'GlobalExceptionFilter',
                        method: 'catch',
                    },
                    'Unexpected generic exception occurred',
                );
            }
        }

        const finalStatusCode = statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
        if (finalStatusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
            Sentry.captureException(exception);
        }

        // Send the standardized JSON error payload to the client
        this.httpAdapterHost.httpAdapter.reply(
            response,
            {
                error: {
                    statusCode: finalStatusCode,
                    message: messages ?? [InternalServerErrorType.DEFAULT],
                    statusText: statusText ?? 'Internal Server Error',
                },
            },
            finalStatusCode,
        );
    }

    /**
     * Extracts database error information if the exception originates from database layers.
     *
     * @param exception The caught exception.
     * @returns Decoded database error information, or null if not a database error.
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
     *
     * @param detail The raw detail string from the database error.
     * @returns A formatted user-friendly message.
     */
    private formatUniqueViolationMessage(detail: unknown): string {
        if (typeof detail === 'string') {
            const match = detail.match(/Key \((.*?)\)=\((.*?)\) already exists/);

            if (match && match.length === 3) {
                const field = match[1];

                if (field === 'email') {
                    return ConflictType.EMAIL_IN_USE;
                }

                return `The ${field} is already in use.`;
            }
        }

        return ConflictType.RESOURCE_ALREADY_EXISTS;
    }
}
