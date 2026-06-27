/**
 * @file health.service.ts
 * @description Manages health diagnostic checks across various application layers (memory, database, and cache) using NestJS Terminus. It provides the core logic to ascertain whether critical dependencies are reachable, preventing the application from accepting traffic when in a degraded state.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    HealthCheckResult,
    HealthCheckService,
    HealthIndicatorResult,
    HealthIndicatorService,
    MemoryHealthIndicator,
} from '@nestjs/terminus';
import { ENV } from 'src/common/config/constant/env.constant';
import { TOKEN_CACHE_HEALTH_INDICATOR } from 'src/common/port/cache/cache.constant';
import type { ICacheHealthIndicator } from 'src/common/port/cache/cache-health-indicator.interface';
import { TOKEN_DATABASE_HEALTH_INDICATOR } from 'src/common/port/database/database.constant';
import type { IDatabaseHealthIndicator } from 'src/common/port/database/database-health-indicator.interface';

/**
 * Facilitates diagnostic checks on memory utilization and database/cache connections.
 * It acts as an abstraction layer to aggregate individual health indicators into a single unified health status.
 */
@Injectable()
export class HealthService {
    /**
     * Injects all required Terminus dependencies and custom health indicators.
     *
     * @param health The core orchestration service provided by Terminus
     * @param memory The memory health diagnostic indicator
     * @param healthIndicatorService The service used to construct custom health indicators
     * @param configService The configuration provider for resolving memory limit thresholds
     * @param databaseHealthIndicator The database health indicator responsible for testing query connectivity
     * @param cacheHealthIndicator The cache health indicator responsible for testing Redis availability
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
     * Aggregates these checks to determine the global health state of the application.
     *
     * @returns The aggregated health check results from Terminus
     * @throws {HealthCheckError} If any health indicator fails to meet its criteria
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
     * Validates the connection to the underlying database by executing a lightweight ping query.
     * Ensures that the application can persist and retrieve data properly.
     *
     * @returns The health indicator status representing the database connectivity
     */
    private async checkDatabase(): Promise<HealthIndicatorResult> {
        const indicator = this.healthIndicatorService.check('database');

        try {
            await this.databaseHealthIndicator.ping();

            return indicator.up();
        } catch {
            return indicator.down({ message: 'Database connection failed.' });
        }
    }

    /**
     * Validates the connection to the Cache and State layers by sending a Redis ping command.
     * Guarantees that rate limiting, sessions, and cached responses can operate without failing.
     *
     * @returns The health indicator status representing the cache connectivity
     */
    private async checkCache(): Promise<HealthIndicatorResult> {
        const indicator = this.healthIndicatorService.check('cache');

        try {
            await this.cacheHealthIndicator.ping();

            return indicator.up();
        } catch {
            return indicator.down({ message: 'Cache connection failed.' });
        }
    }
}
