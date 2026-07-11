/**
 * @file health-reader.adapter.ts
 * @description Adapts the NestJS Terminus package to the application's health check port.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    HealthCheckService,
    HealthIndicatorResult,
    HealthIndicatorService,
    MemoryHealthIndicator,
} from '@nestjs/terminus';
import type { ICacheHealthPort } from 'src/core/cache';
import { TOKEN_CACHE_HEALTH_PORT } from 'src/core/cache';
import { ENV } from 'src/core/config';
import type { IDatabaseHealthPort } from 'src/core/database';
import { TOKEN_DATABASE_HEALTH_PORT } from 'src/core/database';
import type {
    GetHealthStatusResult,
    IGetHealthStatusPort,
} from 'src/module/health/application/query/get-health-status';

/**
 * Adapter that implements the IHealthReaderPort using NestJS Terminus.
 */
@Injectable()
export class HealthReaderAdapter implements IGetHealthStatusPort {
    /**
     * Creates an instance of HealthReaderAdapter.
     *
     * @param health Terminus health check service.
     * @param memory Terminus memory health indicator.
     * @param healthIndicatorService Terminus custom health indicator service.
     * @param configService Application configuration service.
     * @param databaseHealthIndicatorPort Port for database health check.
     * @param cacheHealthIndicatorPort Port for cache health check.
     */
    constructor(
        private readonly health: HealthCheckService,
        private readonly memory: MemoryHealthIndicator,
        private readonly healthIndicatorService: HealthIndicatorService,
        private readonly configService: ConfigService,
        @Inject(TOKEN_DATABASE_HEALTH_PORT)
        private readonly databaseHealthIndicatorPort: IDatabaseHealthPort,
        @Inject(TOKEN_CACHE_HEALTH_PORT) private readonly cacheHealthIndicatorPort: ICacheHealthPort,
    ) {}

    /**
     * Executes the combined health check for memory, database, and cache.
     *
     * @returns A promise resolving to the health check result.
     * @throws {Error} If one or more health indicators fail.
     */
    async getStatus(): Promise<GetHealthStatusResult> {
        const result = await this.health.check([
            () =>
                this.memory.checkHeap(
                    'memory_heap',
                    this.configService.getOrThrow<number>(ENV.HEALTH_HEAP_LIMIT_MB) * 1024 * 1024,
                ),
            () =>
                this.memory.checkRSS(
                    'memory_rss',
                    this.configService.getOrThrow<number>(ENV.HEALTH_RSS_LIMIT_MB) * 1024 * 1024,
                ),
            () => this.checkDatabase(),
            () => this.checkCache(),
        ]);

        return {
            status: result.status,
            info: result.info,
            error: result.error,
            details: result.details,
        } as GetHealthStatusResult;
    }

    /**
     * Checks the database connection health.
     *
     * @returns The database health indicator result.
     */
    private async checkDatabase(): Promise<HealthIndicatorResult> {
        const indicator = this.healthIndicatorService.check('database');

        try {
            await this.databaseHealthIndicatorPort.ping();

            return indicator.up();
        } catch {
            return indicator.down({ message: 'Database connection failed.' });
        }
    }

    /**
     * Checks the cache connection health.
     *
     * @returns The cache health indicator result.
     */
    private async checkCache(): Promise<HealthIndicatorResult> {
        const indicator = this.healthIndicatorService.check('cache');

        try {
            await this.cacheHealthIndicatorPort.ping();

            return indicator.up();
        } catch {
            return indicator.down({ message: 'Cache connection failed.' });
        }
    }
}
