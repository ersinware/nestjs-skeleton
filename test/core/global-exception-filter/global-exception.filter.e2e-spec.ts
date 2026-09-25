/**
 * @file global-exception.filter.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating GlobalExceptionFilter exception catching and sanitization.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ErrorDefaultDto } from 'src/core/exception';
import { TOKEN_ERROR_REPORTER_PORT } from 'src/core/observability/error-reporter';
import { DependencyUnavailableMessage, ResourceNotFoundMessage, SystemMessage } from 'src/shared/exception';
import request from 'supertest';
import {
    ExceptionTriggerController,
    HealthExceptionTriggerController,
} from 'test/core/global-exception-filter/global-exception.filter.fixture';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ErrorBody = Pick<ErrorDefaultDto, 'statusCode' | 'message' | 'statusText'>;

function expectDefaultError(body: unknown): ErrorBody {
    expect(body).toHaveProperty('error');
    const error = (body as { error: ErrorBody }).error;

    expect(Object.keys(error).sort()).toEqual(['message', 'statusCode', 'statusText']);
    expect(typeof error.statusCode).toBe('number');
    expect(Array.isArray(error.message)).toBe(true);
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.message.every((message) => typeof message === 'string')).toBe(true);
    expect(typeof error.statusText).toBe('string');

    return error;
}

describe('GlobalExceptionFilter', () => {
    let app: NestFastifyApplication;

    beforeEach(async () => {
        app = await createTestApp({
            extraControllers: [HealthExceptionTriggerController, ExceptionTriggerController],
            overrides: [{ provide: TOKEN_ERROR_REPORTER_PORT, useValue: { report: vi.fn() } }],
        });
    });

    afterEach(async () => {
        await app.close();
    });

    describe('HttpException outside the exact health route', () => {
        it('should normalize 503 outside the exact health route without disclosing indicator details', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/health-exception-trigger/health-fail')
                .expect(503)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(503);
                    expect(errorDto.message).toEqual([DependencyUnavailableMessage.DEFAULT]);
                });
        });

        it('should format default error wrapping and return ErrorDefaultDto when health check throws a non-503 exception', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/health-exception-trigger/health-non-503')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });
    });

    describe('HttpException', () => {
        it('should catch HttpException with a non-standard status code and fallback to using the HTTP exception class name as the statusText', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/non-standard')
                .expect(499)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(499);
                    expect(errorDto.statusText).toBe('Http Exception');
                    expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
                });
        });

        it('should catch 503 HttpException and sanitize the response message to the default DependencyUnavailableMessage.DEFAULT enum when not on /health', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/service-unavailable')
                .expect(503)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(503);
                    expect(errorDto.statusText).toBe('Service Unavailable');
                    expect(errorDto.message).toEqual([DependencyUnavailableMessage.DEFAULT]);
                });
        });

        it('should catch 500 HttpException and sanitize the response message to the default SystemMessage.DEFAULT enum', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/internal-server-error')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });

        it('should catch 404 HttpException and sanitize the response message to the default ResourceNotFoundMessage.DEFAULT enum', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/not-found')
                .expect(404)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(404);
                    expect(errorDto.statusText).toBe('Not Found');
                    expect(errorDto.message).toEqual([ResourceNotFoundMessage.DEFAULT]);
                });
        });

        it('should catch ValidationPipe errors and return 400 response with message array populated by validation error details matching ErrorDefaultDto format', async () => {
            await request(app.getHttpServer())
                .post('/api/v1/exception-trigger/validation-error')
                .send({})
                .expect(400)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(400);
                    expect(errorDto.statusText).toBe('Bad Request');
                    expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
                });
        });

        it("should catch HttpException with an empty object response and fallback to the exception's own message", async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/empty-object')
                .expect(400)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(400);
                    expect(errorDto.statusText).toBe('Bad Request');
                    expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
                });
        });

        it('should catch HttpException thrown with a raw string response body and map it directly into the message array', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/raw-string')
                .expect(400)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(400);
                    expect(errorDto.statusText).toBe('Bad Request');
                    expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
                });
        });

        it('should catch HttpException with a null response and fallback to using the HTTP exception class name as a single-item array in the message field', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/null-response')
                .expect(400)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(400);
                    expect(errorDto.statusText).toBe('Bad Request');
                    expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
                });
        });

        it('should catch HttpException with a custom response object missing the message property and fallback to using the HTTP exception class name as a single-item array in the message field', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/teapot')
                .expect(418)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(418);
                    expect(errorDto.statusText).toBe('I Am A Teapot');
                    expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
                });
        });
    });

    describe('Database and Unhandled Exceptions', () => {
        it('masks raw PostgreSQL unique violations without disclosing the email value', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-23505')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });

        it('masks raw PostgreSQL unique violations without disclosing another field value', async () => {
            const field = 'username';

            await request(app.getHttpServer())
                .get(`/api/v1/exception-trigger/db-23505-${field}`)
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });

        it('masks raw PostgreSQL unique violations with unrecognized detail', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-23505-fallback')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });

        it('masks raw PostgreSQL unique violations with null detail', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-null-detail')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });

        it('masks raw PostgreSQL foreign key violations', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-23503')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });

        it('masks wrapped raw PostgreSQL foreign key violations', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-cause-23503')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });

        it('should catch generic database errors with unrecognized error codes and return a structured 500 response without leaking database internals', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-unrecognized')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });

        it('should catch database errors where the error code is not 5 characters and fallback to returning a structured 500 response', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-code-length')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });

        it('should catch wrapped database errors where the cause error code is not 5 characters and fallback to returning a structured 500 response', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-cause-code-length')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });

        it('should catch general runtime errors and return a structured 500 Internal Server Error response containing a safe, generic error message', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/runtime-error')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });

        it('should catch non-object exception values (like plain strings) thrown in the application and return a structured 500 response', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/plain-string')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectDefaultError(res.body);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([SystemMessage.DEFAULT]);
                });
        });
    });
});
