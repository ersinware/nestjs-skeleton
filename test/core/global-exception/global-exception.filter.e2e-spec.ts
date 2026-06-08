/**
 * @file global-exception.filter.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating GlobalExceptionFilter exception catching and sanitization.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConflictType } from 'src/common/enum/error/conflict-type.enum';
import { InternalServerErrorType } from 'src/common/enum/error/internal-server-error-type.enum';
import { NotFoundType } from 'src/common/enum/error/not-found-type.enum';
import { ServiceUnavailableType } from 'src/common/enum/error/service-unavailable-type.enum';
import { ErrorDefaultDto } from 'src/common/dto/error-default.dto';
import { UnhealthyDto } from 'src/health/dto/unhealthy.dto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectErrorDto } from '../../shared/dto-assertion.util';
import { createTestApp } from '../../shared/test-app.factory';
import { ExceptionTriggerController, HealthExceptionTriggerController } from './global-exception.fixture';

describe('GlobalExceptionFilter', () => {
    let app: NestFastifyApplication;

    beforeEach(async () => {
        app = await createTestApp({
            extraControllers: [HealthExceptionTriggerController, ExceptionTriggerController],
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(async () => {
        await app.close();
    });

    describe('HttpException on /health route', () => {
        it('should bypass default error wrapping and return health-specific UnhealthyDto under the error key when health check fails', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/health-exception-trigger/health-fail')
                .expect(503)
                .expect((res) => {
                    const unhealthyDto = expectErrorDto(res.body, UnhealthyDto);

                    expect(unhealthyDto.status).toBe('error');
                    expect((unhealthyDto.details['database'] as Record<string, unknown>)['status']).toBe('down');
                    expect((unhealthyDto.details['redis'] as Record<string, unknown>)['status']).toBe('down');
                });
        });

        it('should format default error wrapping and return ErrorDefaultDto when health check throws a non-503 exception', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/health-exception-trigger/health-non-503')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
                });
        });
    });

    describe('HttpException', () => {
        it('should catch HttpException with a non-standard status code and fallback to using the HTTP exception class name as the statusText', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/non-standard')
                .expect(499)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(499);
                    expect(errorDto.statusText).toBe('Http Exception');
                    expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
                });
        });

        it('should catch 503 HttpException and sanitize the response message to the default ServiceUnavailableType.DEFAULT enum when not on /health', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/service-unavailable')
                .expect(503)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(503);
                    expect(errorDto.statusText).toBe('Service Unavailable');
                    expect(errorDto.message).toEqual([ServiceUnavailableType.DEFAULT]);
                });
        });

        it('should catch 500 HttpException and sanitize the response message to the default InternalServerErrorType.DEFAULT enum', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/internal-server-error')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
                });
        });

        it('should catch 404 HttpException and sanitize the response message to the default NotFoundType.DEFAULT enum', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/not-found')
                .expect(404)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(404);
                    expect(errorDto.statusText).toBe('Not Found');
                    expect(errorDto.message).toEqual([NotFoundType.DEFAULT]);
                });
        });

        it('should catch ValidationPipe errors and return 400 response with message array populated by validation error details matching ErrorDefaultDto format', async () => {
            await request(app.getHttpServer())
                .post('/api/v1/exception-trigger/validation-error')
                .send({})
                .expect(400)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

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
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

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
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

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
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

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
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(418);
                    expect(errorDto.statusText).toBe('I Am A Teapot');
                    expect(errorDto.message.length).toBeGreaterThanOrEqual(1);
                });
        });
    });

    describe('Database and Unhandled Exceptions', () => {
        it('should catch database unique constraint violation errors (Postgres code 23505), parse the detailed key message, and return a 409 Conflict response with a user-friendly error message', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-23505')
                .expect(409)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(409);
                    expect(errorDto.statusText).toBe('Conflict');
                    expect(errorDto.message).toEqual([ConflictType.EMAIL_IN_USE]);
                });
        });

        it('should catch database unique constraint violation errors (Postgres code 23505) with non-email field details and return a 409 Conflict response with a field-specific error message', async () => {
            const field = 'username';

            await request(app.getHttpServer())
                .get(`/api/v1/exception-trigger/db-23505-${field}`)
                .expect(409)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(409);
                    expect(errorDto.statusText).toBe('Conflict');
                    expect(errorDto.message).toEqual([`The ${field} is already in use.`]);
                });
        });

        it('should catch database unique constraint violation errors (Postgres code 23505) but fallback to a generic resource exists message if the Postgres error detail cannot be parsed', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-23505-fallback')
                .expect(409)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(409);
                    expect(errorDto.statusText).toBe('Conflict');
                    expect(errorDto.message).toEqual([ConflictType.RESOURCE_ALREADY_EXISTS]);
                });
        });

        it('should catch database unique constraint violation errors (Postgres code 23505) but fallback to resource exists message when detail is not a string (e.g. null)', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-null-detail')
                .expect(409)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(409);
                    expect(errorDto.statusText).toBe('Conflict');
                    expect(errorDto.message).toEqual([ConflictType.RESOURCE_ALREADY_EXISTS]);
                });
        });

        it('should catch database foreign key constraint violation errors (Postgres code 23503) and return a 409 Conflict response with a foreign key violation explanation', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-23503')
                .expect(409)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(409);
                    expect(errorDto.statusText).toBe('Conflict');
                    expect(errorDto.message).toEqual([ConflictType.FOREIGN_KEY_VIOLATION]);
                });
        });

        it('should identify database errors that are nested inside a wrapper error under the cause property and process them using the same constraint mapping rules', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-cause-23503')
                .expect(409)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(409);
                    expect(errorDto.statusText).toBe('Conflict');
                    expect(errorDto.message).toEqual([ConflictType.FOREIGN_KEY_VIOLATION]);
                });
        });

        it('should catch generic database errors with unrecognized error codes and return a structured 500 response without leaking database internals', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-unrecognized')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
                });
        });

        it('should catch database errors where the error code is not 5 characters and fallback to returning a structured 500 response', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-code-length')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
                });
        });

        it('should catch wrapped database errors where the cause error code is not 5 characters and fallback to returning a structured 500 response', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/db-cause-code-length')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
                });
        });

        it('should catch general runtime errors and return a structured 500 Internal Server Error response containing a safe, generic error message', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/runtime-error')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
                });
        });

        it('should catch non-object exception values (like plain strings) thrown in the application and return a structured 500 response', async () => {
            await request(app.getHttpServer())
                .get('/api/v1/exception-trigger/plain-string')
                .expect(500)
                .expect((res) => {
                    const errorDto = expectErrorDto(res.body, ErrorDefaultDto);

                    expect(errorDto.statusCode).toBe(500);
                    expect(errorDto.statusText).toBe('Internal Server Error');
                    expect(errorDto.message).toEqual([InternalServerErrorType.DEFAULT]);
                });
        });
    });
});
