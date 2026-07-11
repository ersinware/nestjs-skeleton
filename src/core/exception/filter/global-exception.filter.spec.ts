/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file global-exception.filter.spec.ts
 * @description Unit tests for the global exception filter.
 */

import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ErrorDefaultDto } from 'src/core/exception/dto/error-default.dto';
import { InternalServerErrorType } from 'src/core/exception/enum/internal-server-error-type.enum';
import { ResourceConflictType } from 'src/core/exception/enum/resource-conflict-type.enum';
import { ResourceNotFoundType } from 'src/core/exception/enum/resource-not-found-type.enum';
import { ServiceUnavailableType } from 'src/core/exception/enum/service-unavailable-type.enum';
import { GlobalExceptionFilter } from 'src/core/exception/filter/global-exception.filter';
import {
    AuditLogAction,
    AuditLogPayload,
    LogPayload,
    TOKEN_EXCEPTION_TRACKER_PORT,
    TOKEN_LOGGER_PORT,
    type IExceptionTrackerPort,
    type ILoggerPort,
} from 'src/core/observability';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('GlobalExceptionFilter', () => {
    const mockHttpAdapterHost = {
            httpAdapter: {
                reply: vi.fn(),
            },
        },
        mockLoggerPort = {
            error: vi.fn(),
            warn: vi.fn(),
            log: vi.fn(),
        } as unknown as ILoggerPort,
        mockExceptionTrackerPort = {
            captureException: vi.fn(),
        } as unknown as IExceptionTrackerPort;

    let filter: GlobalExceptionFilter;

    function createSecurityAuditLogPayload(error: string) {
        return new AuditLogPayload({
            class: GlobalExceptionFilter.name,
            method: filter.catch.name,
            action: AuditLogAction.SECURITY_EXCEPTION,
            error,
        });
    }

    function createErrorLogPayload(error: Error) {
        return new LogPayload({
            class: GlobalExceptionFilter.name,
            method: filter.catch.name,
            error,
        });
    }

    /**
     * Helper to create a mocked NestJS ArgumentsHost.
     *
     * @param url Request URL to return.
     * @returns Mocked ArgumentsHost instance.
     */
    function createMockArgumentsHost(url = '/') {
        return {
            switchToHttp: () => ({
                getRequest: () => ({ url }),
                getResponse: () => ({ isResponse: true }),
            }),
        } as unknown as ArgumentsHost;
    }

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GlobalExceptionFilter,
                {
                    provide: HttpAdapterHost,
                    useValue: mockHttpAdapterHost,
                },
                {
                    provide: TOKEN_LOGGER_PORT,
                    useValue: mockLoggerPort,
                },
                {
                    provide: TOKEN_EXCEPTION_TRACKER_PORT,
                    useValue: mockExceptionTrackerPort,
                },
            ],
        }).compile();

        filter = module.get<GlobalExceptionFilter>(GlobalExceptionFilter);
    });

    it('should be defined', () => {
        expect(filter).toBeDefined();
    });

    describe('HTTP exceptions', () => {
        it('should return raw exception as-is when the request is to the /health endpoint and status code is 503', () => {
            const response = {
                body: 'body',
                statusCode: 503,
            };

            filter.catch(new HttpException(response.body, response.statusCode), createMockArgumentsHost('/health'));

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: response.body,
                },
                response.statusCode,
            );
        });

        it('should fallback to exception name for statusText when status code is not standard', () => {
            const response = {
                statusCode: 499,
                message: 'Non-standard status code error message',
            };

            filter.catch(new HttpException(response.message, response.statusCode), createMockArgumentsHost());

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: response.statusCode,
                        message: [response.message],
                        statusText: 'Http Exception',
                    } satisfies ErrorDefaultDto,
                },
                response.statusCode,
            );
        });

        it('should format the response when the request is to the /health endpoint but status code is not 503', () => {
            const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

            filter.catch(
                new HttpException('Sensitive stack trace or message', statusCode),
                createMockArgumentsHost('/health'),
            );

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [InternalServerErrorType.DEFAULT],
                        statusText: 'Internal Server Error',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should override 503 Service Unavailable exception with ServiceUnavailableType.DEFAULT when not on /health', () => {
            const statusCode = HttpStatus.SERVICE_UNAVAILABLE;

            filter.catch(
                new HttpException('Custom service unavailable message', statusCode),
                createMockArgumentsHost(),
            );

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [ServiceUnavailableType.DEFAULT],
                        statusText: 'Service Unavailable',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should override 500 Internal Server Error exception with InternalServerErrorType.DEFAULT', () => {
            const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

            filter.catch(new HttpException('Sensitive stack trace or message', statusCode), createMockArgumentsHost());

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [InternalServerErrorType.DEFAULT],
                        statusText: 'Internal Server Error',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should override 404 Not Found exception with ResourceNotFoundType.DEFAULT', () => {
            const statusCode = HttpStatus.NOT_FOUND;

            filter.catch(new HttpException('Custom not found message', statusCode), createMockArgumentsHost());

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [ResourceNotFoundType.DEFAULT],
                        statusText: 'Not Found',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should handle HttpException when the exception is an object with an array of messages', () => {
            const response = {
                statusCode: 400,
                message: ['email must be an email', 'password must be longer than 8 characters'],
                statusText: 'Bad Request',
            };

            filter.catch(new HttpException(response, response.statusCode), createMockArgumentsHost());

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: response.statusCode,
                        message: response.message,
                        statusText: response.statusText,
                    } satisfies ErrorDefaultDto,
                },
                response.statusCode,
            );
        });

        it('should handle HttpException when the exception is an object with a string message', () => {
            const response = {
                statusCode: 400,
                message: 'Bad request message',
                statusText: 'Bad Request',
            };

            filter.catch(new HttpException(response, response.statusCode), createMockArgumentsHost());

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: response.statusCode,
                        message: [response.message],
                        statusText: response.statusText,
                    } satisfies ErrorDefaultDto,
                },
                response.statusCode,
            );
        });

        it('should fallback to exception message when the exception does not contain a message property', () => {
            const statusCode = 400;

            filter.catch(new HttpException({}, statusCode), createMockArgumentsHost());

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: ['Http Exception'],
                        statusText: 'Bad Request',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should handle HttpException when the exception is a plain string', () => {
            const response = {
                message: 'Plain string error',
                statusCode: 403,
            };

            filter.catch(new HttpException(response.message, response.statusCode), createMockArgumentsHost());

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: response.statusCode,
                        message: [response.message],
                        statusText: 'Forbidden',
                    } satisfies ErrorDefaultDto,
                },
                response.statusCode,
            );

            expect(mockLoggerPort.warn).toHaveBeenCalledWith(createSecurityAuditLogPayload(response.message));
        });

        it('should fallback to exception message when response is neither object nor string (e.g. null)', () => {
            const statusCode = 400;

            filter.catch(new HttpException(null as unknown as string, statusCode), createMockArgumentsHost());

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: ['Http Exception'],
                        statusText: 'Bad Request',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should log audit log metadata and format HTTP response when cause is an instance of AuditLogPayload', () => {
            const statusCode = 401;
            const message = 'Unauthorized';
            const auditPayload = new AuditLogPayload({
                class: 'AuthService',
                method: 'loginUser',
                action: AuditLogAction.LOGIN_FAILED,
            });
            const exception = new HttpException(message, statusCode, {
                cause: auditPayload,
            });

            filter.catch(exception, createMockArgumentsHost());

            expect(mockLoggerPort.warn).toHaveBeenCalledWith(auditPayload);

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode,
                        message: [message],
                        statusText: 'Unauthorized',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });
    });

    describe('Database errors', () => {
        it('should handle unique constraint violation (code 23505) with details', () => {
            const statusCode = 409;

            filter.catch(
                Object.assign(new Error('Unique constraint violation'), {
                    code: '23505',
                    detail: 'Key (email)=(test@example.com) already exists',
                }),
                createMockArgumentsHost(),
            );

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [ResourceConflictType.EMAIL_IN_USE],
                        statusText: 'Conflict',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should handle unique constraint violation (code 23505) with non-email field details', () => {
            const statusCode = 409,
                field = 'username';

            filter.catch(
                Object.assign(new Error('Unique constraint violation'), {
                    code: '23505',
                    detail: `Key (${field})=(testuser) already exists`,
                }),
                createMockArgumentsHost(),
            );

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [`The ${field} is already in use.`],
                        statusText: 'Conflict',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should handle unique constraint violation (code 23505) without formatted details', () => {
            const statusCode = 409;

            filter.catch(
                Object.assign(new Error('Unique constraint violation'), {
                    code: '23505',
                    detail: 'unformatted details',
                }),
                createMockArgumentsHost(),
            );

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [ResourceConflictType.DEFAULT],
                        statusText: 'Conflict',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should log and fallback to 500 when unique constraint violation detail is not a string', () => {
            const statusCode = 409;

            filter.catch(
                Object.assign(new Error('Unique constraint violation'), {
                    code: '23505',
                    detail: null,
                }),
                createMockArgumentsHost(),
            );

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [ResourceConflictType.DEFAULT],
                        statusText: 'Conflict',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should handle foreign key constraint violation (code 23503)', () => {
            const statusCode = 409;

            filter.catch(
                Object.assign(new Error('Foreign key constraint violation'), {
                    code: '23503',
                }),
                createMockArgumentsHost(),
            );

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [ResourceConflictType.FOREIGN_KEY_VIOLATION],
                        statusText: 'Conflict',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should handle wrapped database error via cause property', () => {
            const statusCode = 409;

            filter.catch(
                Object.assign(new Error('Wrapped database error'), {
                    cause: {
                        code: '23503',
                    },
                }),
                createMockArgumentsHost(),
            );

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [ResourceConflictType.FOREIGN_KEY_VIOLATION],
                        statusText: 'Conflict',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should log and fallback to 500 when database error code is unhandled', () => {
            const statusCode = 500,
                response = Object.assign(new Error('Unhandled database error'), {
                    code: '99999',
                });

            filter.catch(response, createMockArgumentsHost());

            expect(mockLoggerPort.error).toHaveBeenCalledWith(createErrorLogPayload(response));
            expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(response);

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [InternalServerErrorType.DEFAULT],
                        statusText: 'Internal Server Error',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should log and fallback to 500 when database error code is not 5 characters', () => {
            const statusCode = 500,
                response = Object.assign(new Error('Invalid error code'), {
                    code: '123',
                });

            filter.catch(response, createMockArgumentsHost());

            expect(mockLoggerPort.error).toHaveBeenCalledWith(createErrorLogPayload(response));
            expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(response);

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [InternalServerErrorType.DEFAULT],
                        statusText: 'Internal Server Error',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should log and fallback to 500 when wrapped database error cause code is not 5 characters', () => {
            const statusCode = 500,
                response = Object.assign(new Error('Invalid wrapped error code'), {
                    cause: {
                        code: '1234',
                    },
                });

            filter.catch(response, createMockArgumentsHost());

            expect(mockLoggerPort.error).toHaveBeenCalledWith(createErrorLogPayload(response));
            expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(response);

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [InternalServerErrorType.DEFAULT],
                        statusText: 'Internal Server Error',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });
    });

    describe('Unhandled exceptions', () => {
        it('should handle generic error and log it', () => {
            const statusCode = 500,
                response = new Error();

            filter.catch(response, createMockArgumentsHost());

            expect(mockLoggerPort.error).toHaveBeenCalledWith(createErrorLogPayload(response));
            expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(response);

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [InternalServerErrorType.DEFAULT],
                        statusText: 'Internal Server Error',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });

        it('should handle non-object exception values safely', () => {
            const statusCode = 500,
                response = 'Plain string error thrown';

            filter.catch(response, createMockArgumentsHost());

            expect(mockLoggerPort.error).toHaveBeenCalledWith(createErrorLogPayload(new Error(response)));
            expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(response);

            expect(mockHttpAdapterHost.httpAdapter.reply).toHaveBeenCalledWith(
                { isResponse: true },
                {
                    error: {
                        statusCode: statusCode,
                        message: [InternalServerErrorType.DEFAULT],
                        statusText: 'Internal Server Error',
                    } satisfies ErrorDefaultDto,
                },
                statusCode,
            );
        });
    });
});
