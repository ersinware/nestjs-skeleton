/**
 * @file response.interceptor.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating ResponseInterceptor response wrapping behaviors.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { ResponseInterceptorTriggerController } from 'test/core/response-interceptor/response.interceptor.fixture';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterEach, beforeEach, describe, it } from 'vitest';

describe('ResponseInterceptor', () => {
    let app: NestFastifyApplication;

    beforeEach(async () => {
        app = await createTestApp({ extraControllers: [ResponseInterceptorTriggerController] });
    });

    afterEach(async () => {
        await app.close();
    });

    it('should return 204 No Content response unmodified with empty body', async () => {
        await request(app.getHttpServer()).get('/api/v1/response-interceptor-trigger/204').expect(204, {});
    });

    it('should return 304 Not Modified response unmodified with empty body', async () => {
        await request(app.getHttpServer()).get('/api/v1/response-interceptor-trigger/304').expect(304, {});
    });

    it('should wrap the returned data object under the "data" key', async () => {
        await request(app.getHttpServer())
            .get('/api/v1/response-interceptor-trigger/data')
            .expect(200, { data: { id: 1 } });
    });

    it('should wrap a returned null value as "data: null"', async () => {
        await request(app.getHttpServer()).get('/api/v1/response-interceptor-trigger/null').expect(200, { data: null });
    });

    it('should wrap a returned undefined value as "data: null"', async () => {
        await request(app.getHttpServer())
            .get('/api/v1/response-interceptor-trigger/undefined')
            .expect(200, { data: null });
    });
});
