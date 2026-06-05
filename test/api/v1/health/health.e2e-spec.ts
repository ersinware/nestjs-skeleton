/**
 * @file health.e2e-spec.ts
 * @description End-to-end (E2E) integration test suite validating HealthController status and diagnostics.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { HealthyDto } from 'src/health/dto/healthy.dto';
import { UnhealthyDto } from 'src/health/dto/unhealthy.dto';
import { TOKEN_CACHE_HEALTH_INDICATOR } from 'src/cache/constant/cache.constant';
import type { ICacheHealthIndicator } from 'src/cache/interface/cache-health-indicator.interface';
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
                expectDataDto(res.body, HealthyDto);
            });
    });

    it('GET /health - should return 503 service unavailable when Cache is down', async () => {
        const cacheHealthIndicator = app.get<ICacheHealthIndicator>(TOKEN_CACHE_HEALTH_INDICATOR),
            spy = vi.spyOn(cacheHealthIndicator, 'ping').mockRejectedValueOnce(new Error());

        await request(app.getHttpServer())
            .get('/api/health')
            .expect(503)
            .expect((res) => {
                const dto = expectErrorDto(res.body, UnhealthyDto);

                expect(dto.status).toBe('error');
                expect(dto.error).toHaveProperty('cache');
                expect((dto.error['cache'] as Record<string, unknown>)['status']).toBe('down');
            });

        expect(spy).toHaveBeenCalledTimes(1);
    });
});
