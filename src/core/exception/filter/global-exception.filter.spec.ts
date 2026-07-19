/**
 * @file global-exception.filter.spec.ts
 * @description Unit tests for the global exception filter — status mapping, response normalization, and the logging decision.
 */

import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PATH_HEALTH } from 'src/core/config';
import { ErrorDefaultDto } from 'src/core/exception/dto/error-default.dto';
import { GlobalExceptionFilter } from 'src/core/exception/filter/global-exception.filter';
import { AuditLogAction, AuditLogPayload, LogPayload, TOKEN_LOGGER_PORT } from 'src/core/observability/logger';
import { TOKEN_EXCEPTION_TRACKER_PORT } from 'src/core/observability/tracker';
import type { AuthenticatedRequest } from 'src/core/security/auth';
import {
    AccessDeniedException,
    DependencyUnavailableException,
    DependencyUnavailableMessage,
    InvalidInputException,
    ResourceConflictException,
    ResourceNotFoundException,
    ResourceNotFoundMessage,
    SystemException,
    SystemMessage,
    UnauthenticatedException,
    type ExceptionContext,
} from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('GlobalExceptionFilter', () => {
    const mockReply = vi.fn(),
        mockLoggerPort = {
            error: vi.fn(),
            warn: vi.fn(),
            log: vi.fn(),
        },
        mockExceptionTrackerPort = {
            captureException: vi.fn(),
        };

    const context: ExceptionContext = { class: 'SomeHandler', method: 'execute', reason: 'SESSION_REUSE' };

    let filter: GlobalExceptionFilter;

    /**
     * Builds the ArgumentsHost the filter reads, defaulting to an unauthenticated request on a
     * non-health route so each test only states the part it actually cares about.
     */
    function createHost(request: Partial<AuthenticatedRequest> & { url?: string } = {}): ArgumentsHost {
        const response = { sent: true };

        return {
            switchToHttp: () => ({
                getResponse: () => response,
                getRequest: () => ({ url: '/api/v1/user', ...request }),
            }),
        } as unknown as ArgumentsHost;
    }

    /** Extracts the `ErrorDefaultDto` the filter replied with. */
    function repliedDto(): ErrorDefaultDto {
        const [, body] = mockReply.mock.calls[0] as [unknown, { error: ErrorDefaultDto }];

        return body.error;
    }

    /** Extracts the raw status code the filter replied with. */
    function repliedStatus(): number {
        const [, , statusCode] = mockReply.mock.calls[0] as [unknown, unknown, number];

        return statusCode;
    }

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GlobalExceptionFilter,
                {
                    provide: HttpAdapterHost,
                    useValue: { httpAdapter: { reply: mockReply } },
                },
                { provide: TOKEN_LOGGER_PORT, useValue: mockLoggerPort },
                {
                    provide: TOKEN_EXCEPTION_TRACKER_PORT,
                    useValue: mockExceptionTrackerPort,
                },
            ],
        }).compile();

        filter = module.get(GlobalExceptionFilter);
    });

    it('should be defined', () => {
        expect(filter).toBeDefined();
    });

    describe('health-check passthrough', () => {
        it('should reply with the indicator raw body unnormalized for a 503 on the health path', () => {
            const indicatorBody = { status: 'error', details: { redis: { status: 'down' } } },
                exception = new HttpException(indicatorBody, HttpStatus.SERVICE_UNAVAILABLE);

            filter.catch(exception, createHost({ url: PATH_HEALTH }));

            expect(mockReply).toHaveBeenCalledWith(
                expect.anything(),
                { error: indicatorBody },
                HttpStatus.SERVICE_UNAVAILABLE,
            );
            expect(mockLoggerPort.warn).not.toHaveBeenCalled();
            expect(mockLoggerPort.error).not.toHaveBeenCalled();
            expect(mockExceptionTrackerPort.captureException).not.toHaveBeenCalled();
        });

        it('should strip the query string before matching the health path', () => {
            const indicatorBody = { status: 'error' },
                exception = new HttpException(indicatorBody, HttpStatus.SERVICE_UNAVAILABLE);

            filter.catch(exception, createHost({ url: `${PATH_HEALTH}?verbose=true` }));

            expect(mockReply).toHaveBeenCalledWith(
                expect.anything(),
                { error: indicatorBody },
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        });

        it('should normalize a 503 raised outside the health path', () => {
            const exception = new HttpException({ status: 'error' }, HttpStatus.SERVICE_UNAVAILABLE);

            filter.catch(exception, createHost({ url: '/api/v1/user' }));

            expect(repliedDto()).toBeInstanceOf(ErrorDefaultDto);
            expect(repliedDto().message).toEqual([DependencyUnavailableMessage.DEFAULT]);
        });

        it('should normalize a non-503 response on the health path', () => {
            const exception = new HttpException('Nope', HttpStatus.BAD_REQUEST);

            filter.catch(exception, createHost({ url: PATH_HEALTH }));

            expect(repliedDto()).toBeInstanceOf(ErrorDefaultDto);
            expect(repliedDto().statusCode).toBe(HttpStatus.BAD_REQUEST);
        });

        it('should normalize a non-HttpException even on the health path', () => {
            filter.catch(new Error('boom'), createHost({ url: PATH_HEALTH }));

            expect(repliedDto().statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        });
    });

    describe('taxonomy kind to HTTP status mapping', () => {
        it.each([
            [ResourceNotFoundException, HttpStatus.NOT_FOUND, 'Not Found'],
            [ResourceConflictException, HttpStatus.CONFLICT, 'Conflict'],
            [UnauthenticatedException, HttpStatus.UNAUTHORIZED, 'Unauthorized'],
            [AccessDeniedException, HttpStatus.FORBIDDEN, 'Forbidden'],
            [InvalidInputException, HttpStatus.BAD_REQUEST, 'Bad Request'],
            [DependencyUnavailableException, HttpStatus.SERVICE_UNAVAILABLE, 'Service Unavailable'],
            [SystemException, HttpStatus.INTERNAL_SERVER_ERROR, 'Internal Server Error'],
        ])('should map %s to its HTTP status and derived status text', (ExceptionClass, statusCode, statusText) => {
            filter.catch(new ExceptionClass('Some failure.'), createHost());

            expect(repliedDto()).toBeInstanceOf(ErrorDefaultDto);
            expect(repliedDto().statusCode).toBe(statusCode);
            expect(repliedDto().statusText).toBe(statusText);
            expect(repliedStatus()).toBe(statusCode);
        });

        it("should carry the taxonomy exception's own message through to the client", () => {
            filter.catch(new ResourceConflictException('Email already in use.'), createHost());

            expect(repliedDto().message).toEqual(['Email already in use.']);
        });
    });

    describe('HttpException normalization', () => {
        it('should replace a 5xx body with the generic system message so internals never leak', () => {
            const exception = new HttpException('Connection string is postgres://root:hunter2@db', 500);

            filter.catch(exception, createHost());

            expect(repliedDto().message).toEqual([SystemMessage.DEFAULT]);
        });

        it('should replace a 404 body with the generic not-found message', () => {
            filter.catch(new HttpException('No user with id 42', HttpStatus.NOT_FOUND), createHost());

            expect(repliedDto().message).toEqual([ResourceNotFoundMessage.DEFAULT]);
        });

        it('should preserve the array of validation messages from a ValidationPipe response', () => {
            const messages = ['email must be an email', 'password is too weak'],
                exception = new HttpException({ message: messages }, HttpStatus.BAD_REQUEST);

            filter.catch(exception, createHost());

            expect(repliedDto().message).toEqual(messages);
        });

        it('should wrap a single string message from an object response into an array', () => {
            const exception = new HttpException({ message: 'Bad payload' }, HttpStatus.BAD_REQUEST);

            filter.catch(exception, createHost());

            expect(repliedDto().message).toEqual(['Bad payload']);
        });

        it('should wrap a plain string response into an array', () => {
            filter.catch(new HttpException('Bad payload', HttpStatus.BAD_REQUEST), createHost());

            expect(repliedDto().message).toEqual(['Bad payload']);
        });

        it('should stringify non-string members of a message array', () => {
            const exception = new HttpException({ message: [1, null] }, HttpStatus.BAD_REQUEST);

            filter.catch(exception, createHost());

            expect(repliedDto().message).toEqual(['1', 'null']);
        });

        it("should fall back to the exception's own message when the response object has no usable message", () => {
            const exception = new HttpException({ statusCode: 400 }, HttpStatus.BAD_REQUEST);

            filter.catch(exception, createHost());

            expect(repliedDto().message).toEqual([expect.any(String)]);
        });

        it('should derive the status text from the exception name for a non-standard status code', () => {
            filter.catch(new HttpException('Teapot', 599), createHost());

            expect(repliedDto().statusText).toBe('Http Exception');
        });
    });

    describe('unknown exceptions', () => {
        it.each([
            ['a plain Error', new Error('boom')],
            ['a string', 'boom'],
            ['null', null],
            ['undefined', undefined],
            ['a plain object', { boom: true }],
        ])('should normalize %s into a generic 500', (_label, thrown) => {
            filter.catch(thrown, createHost());

            expect(repliedDto().statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
            expect(repliedDto().message).toEqual([SystemMessage.DEFAULT]);
            expect(repliedDto().statusText).toBe('Internal Server Error');
        });
    });

    describe('logging decision', () => {
        describe('503 — silent', () => {
            it('should neither log nor capture a dependency-unavailable rejection', () => {
                filter.catch(new DependencyUnavailableException(DependencyUnavailableMessage.DEFAULT), createHost());

                expect(mockLoggerPort.warn).not.toHaveBeenCalled();
                expect(mockLoggerPort.error).not.toHaveBeenCalled();
                expect(mockExceptionTrackerPort.captureException).not.toHaveBeenCalled();
            });

            it('should stay silent even when the thrower attached context', () => {
                filter.catch(
                    new DependencyUnavailableException(DependencyUnavailableMessage.DEFAULT, { context }),
                    createHost(),
                );

                expect(mockLoggerPort.warn).not.toHaveBeenCalled();
                expect(mockLoggerPort.error).not.toHaveBeenCalled();
            });
        });

        describe('5xx — error log and Sentry, checked before the audit branches', () => {
            it('should log an error and capture an unknown exception', () => {
                const thrown = new Error('boom');

                filter.catch(thrown, createHost());

                expect(mockLoggerPort.error).toHaveBeenCalledWith(
                    new LogPayload({
                        class: GlobalExceptionFilter.name,
                        method: 'catch',
                        error: thrown,
                        context: undefined,
                    }),
                );
                expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(thrown);
                expect(mockLoggerPort.warn).not.toHaveBeenCalled();
            });

            it('should coerce a non-Error throwable into an Error for the log payload', () => {
                filter.catch('boom', createHost());

                expect(mockLoggerPort.error).toHaveBeenCalledWith(
                    expect.objectContaining({ error: new Error('boom') }),
                );
                expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith('boom');
            });

            it('should keep a context-carrying SystemException on the error path rather than degrading to warn', () => {
                const thrown = new SystemException('Mutation attempted on a soft-deleted account.', { context });

                filter.catch(thrown, createHost());

                expect(mockLoggerPort.error).toHaveBeenCalledWith(expect.objectContaining({ context }));
                expect(mockExceptionTrackerPort.captureException).toHaveBeenCalledWith(thrown);
                expect(mockLoggerPort.warn).not.toHaveBeenCalled();
            });
        });

        describe('security-audited statuses', () => {
            it('should audit a 403 with the SECURITY_EXCEPTION action', () => {
                filter.catch(new AccessDeniedException('Insufficient privileges.'), createHost());

                expect(mockLoggerPort.warn).toHaveBeenCalledWith(
                    new AuditLogPayload({
                        class: GlobalExceptionFilter.name,
                        method: 'catch',
                        action: AuditLogAction.SECURITY_EXCEPTION,
                        error: 'Insufficient privileges.',
                        sub: undefined,
                        role: undefined,
                        context: undefined,
                    }),
                );
                expect(mockExceptionTrackerPort.captureException).not.toHaveBeenCalled();
            });

            it('should audit a 429 with the SECURITY_EXCEPTION action', () => {
                filter.catch(new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS), createHost());

                expect(mockLoggerPort.warn).toHaveBeenCalledWith(
                    expect.objectContaining({ action: AuditLogAction.SECURITY_EXCEPTION }),
                );
            });

            it('should audit a 401 that carries context', () => {
                filter.catch(new UnauthenticatedException('Session reuse detected.', { context }), createHost());

                expect(mockLoggerPort.warn).toHaveBeenCalledWith(
                    expect.objectContaining({ action: AuditLogAction.SECURITY_EXCEPTION, context }),
                );
            });

            it('should stay silent on a routine 401 with no context', () => {
                filter.catch(new UnauthenticatedException('Token expired.'), createHost());

                expect(mockLoggerPort.warn).not.toHaveBeenCalled();
                expect(mockLoggerPort.error).not.toHaveBeenCalled();
            });

            it("should attach the caller's identity when the route was authenticated", () => {
                const accessTokenPayload = { sub: 'user-1', role: 'USER' };

                filter.catch(
                    new AccessDeniedException('Insufficient privileges.'),
                    createHost({ accessTokenPayload } as Partial<AuthenticatedRequest>),
                );

                expect(mockLoggerPort.warn).toHaveBeenCalledWith(
                    expect.objectContaining({ sub: 'user-1', role: 'USER' }),
                );
            });

            it('should join a multi-message body into a single error string', () => {
                const exception = new HttpException(
                    { message: ['first reason', 'second reason'] },
                    HttpStatus.FORBIDDEN,
                );

                filter.catch(exception, createHost());

                expect(mockLoggerPort.warn).toHaveBeenCalledWith(
                    expect.objectContaining({ error: 'first reason, second reason' }),
                );
            });
        });

        describe('non-security rejections carrying context', () => {
            it('should warn without the security action for a context-carrying 400', () => {
                filter.catch(new InvalidInputException('Password is too weak.', { context }), createHost());

                const [payload] = mockLoggerPort.warn.mock.calls[0] as [LogPayload];

                expect(payload).toBeInstanceOf(LogPayload);
                expect(payload).not.toBeInstanceOf(AuditLogPayload);
                expect(payload['action']).toBeUndefined();
                expect(payload['context']).toEqual(context);
            });

            it.each([
                ['404', ResourceNotFoundException],
                ['409', ResourceConflictException],
            ])('should warn without the security action for a context-carrying %s', (_label, ExceptionClass) => {
                filter.catch(new ExceptionClass('Some failure.', { context }), createHost());

                expect(mockLoggerPort.warn).toHaveBeenCalledWith(expect.objectContaining({ context }));
                expect(mockLoggerPort.warn).not.toHaveBeenCalledWith(
                    expect.objectContaining({ action: AuditLogAction.SECURITY_EXCEPTION }),
                );
            });

            it('should carry the context verbatim under its own key without merging it', () => {
                filter.catch(new InvalidInputException('Password is too weak.', { context }), createHost());

                const [payload] = mockLoggerPort.warn.mock.calls[0] as [LogPayload];

                expect(payload['context']).toBe(context);
                expect(payload['reason']).toBeUndefined();
            });
        });

        describe('rejections with neither context nor a security status', () => {
            it.each([
                ['a 400', new InvalidInputException('Password is too weak.')],
                ['a 404', new ResourceNotFoundException('User not found.')],
                ['a 409', new ResourceConflictException('Email already in use.')],
                ['a non-taxonomy 4xx HttpException', new HttpException('Bad payload', HttpStatus.BAD_REQUEST)],
            ])('should stay silent for %s', (_label, thrown) => {
                filter.catch(thrown, createHost());

                expect(mockLoggerPort.warn).not.toHaveBeenCalled();
                expect(mockLoggerPort.error).not.toHaveBeenCalled();
                expect(mockExceptionTrackerPort.captureException).not.toHaveBeenCalled();
            });
        });
    });
});
