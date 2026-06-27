/**
 * @file health.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating HealthController status and diagnostics.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ResponseHealthyDto } from 'src/api/health/dto/response-healthy.dto';
import { ResponseUnhealthyDto } from 'src/api/health/dto/response-unhealthy.dto';
import { TOKEN_CACHE_HEALTH_INDICATOR } from 'src/common/port/cache/cache.constant';
import type { ICacheHealthIndicator } from 'src/common/port/cache/cache-health-indicator.interface';
import { createTestApp } from '../../../shared/test-app.factory';
import { expectDataDto, expectErrorDto } from '../../../shared/dto-assertion.util';

describe('HealthController', () => {
    let app: NestFastifyApplication;

    beforeEach(async () => {
        app = await createTestApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET /health - should return service health status', async () => {
        await request(app.getHttpServer())
            .get('/api/health')
            .expect(200)
            .expect((res) => {
                expectDataDto(res.body, ResponseHealthyDto);
            });
    });

    it('GET /health - should return 503 service unavailable when Cache is down', async () => {
        const cacheHealthIndicator = app.get<ICacheHealthIndicator>(TOKEN_CACHE_HEALTH_INDICATOR),
            spy = vi.spyOn(cacheHealthIndicator, 'ping').mockRejectedValueOnce(new Error());

        await request(app.getHttpServer())
            .get('/api/health')
            .expect(503)
            .expect((res) => {
                const dto = expectErrorDto(res.body, ResponseUnhealthyDto);

                expect(dto.status).toBe('error');
                expect(dto.error).toHaveProperty('cache');
                expect((dto.error['cache'] as Record<string, unknown>)['status']).toBe('down');
            });

        expect(spy).toHaveBeenCalledTimes(1);
    });
});
