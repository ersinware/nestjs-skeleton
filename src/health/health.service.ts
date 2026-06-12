/**
 * @file health.service.ts
 * @description Service managing memory, database, and Redis connectivity health indicators using NestJS Terminus.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckResult, HealthCheckService, HealthIndicatorService, MemoryHealthIndicator } from '@nestjs/terminus';
import { TOKEN_CACHE_HEALTH_INDICATOR } from 'src/cache/constant/cache.constant';
import { ENV } from 'src/common/config/constant/env.constant';
import type { ICacheHealthIndicator } from 'src/cache/interface/cache-health-indicator.interface';
import { TOKEN_DATABASE_HEALTH_INDICATOR } from 'src/database/constant/database.constant';
import type { IDatabaseHealthIndicator } from 'src/database/interface/database-health-indicator.interface';

/**
 * Service facilitating diagnostic checks on memory utilization and database/cache connections.
 */
@Injectable()
export class HealthService {
    /**
     * Creates an instance of HealthService.
     *
     * @param health Health check orchestration service.
     * @param memory Memory health diagnostic indicator.
     * @param healthIndicatorService Service to create custom health indicators.
     * @param configService Configuration provider for reading memory limit thresholds.
     * @param databaseHealthIndicator Database health indicator to test connection.
     * @param cacheHealthIndicator Cache and State health indicator to test connection.
     */
    constructor(
        private readonly health: HealthCheckService,
        private readonly memory: MemoryHealthIndicator,
        private readonly healthIndicatorService: HealthIndicatorService,
        private readonly configService: ConfigService,
        @Inject(TOKEN_DATABASE_HEALTH_INDICATOR) private readonly databaseHealthIndicator: IDatabaseHealthIndicator,
        @Inject(TOKEN_CACHE_HEALTH_INDICATOR) private readonly cacheHealthIndicator: ICacheHealthIndicator,
    ) {}

    /**
     * Executes heap memory, RSS memory, PostgreSQL, and Cache/State connectivity checks.
     *
     * @returns The health check results from Terminus.
     * @throws {ServiceUnavailableException} If any health check indicator fails.
     */
    async check(): Promise<HealthCheckResult> {
        return this.health.check([
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
    }

    /**
     * Validates connection to the database by executing a query.
     *
     * @returns A health indicator status.
     */
    private async checkDatabase() {
        const indicator = this.healthIndicatorService.check('database');

        try {
            await this.databaseHealthIndicator.ping();

            return indicator.up();
        } catch {
            return indicator.down({ message: 'Database connection failed.' });
        }
    }

    /**
     * Validates connection to Cache and State by sending a ping command.
     *
     * @returns A health indicator status.
     */
    private async checkCache() {
        const indicator = this.healthIndicatorService.check('cache');

        try {
            await this.cacheHealthIndicator.ping();

            return indicator.up();
        } catch {
            return indicator.down({ message: 'Cache connection failed.' });
        }
    }
}
