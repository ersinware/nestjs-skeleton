/**
 * @file health-reader.adapter.ts
 * @description Adapts the NestJS Terminus package to the application's health check port.
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
import type { ICacheHealthPort } from 'src/core/cache';
import { TOKEN_CACHE_HEALTH_PORT } from 'src/core/cache';
import { ENV } from 'src/core/config';
import type { IDatabaseHealthPort } from 'src/core/database';
import { TOKEN_DATABASE_HEALTH_PORT } from 'src/core/database';
import type { ISessionHealthPort } from 'src/core/security/session';
import { TOKEN_SESSION_HEALTH_PORT } from 'src/core/security/session';
import type { IGetHealthStatusPort } from 'src/module/health/application/query/get-health-status/port';
import {
    GetHealthStatusResult,
    HealthIndicatorKey,
    UnhealthyIndicatorMessage,
} from 'src/module/health/application/query/get-health-status/query';
import { SystemException } from 'src/shared/exception';

/**
 * Implements the health read port with Terminus, composing the core health ports into one report.
 */
@Injectable()
export class HealthReaderAdapter implements IGetHealthStatusPort {
    /**
     * Creates the adapter.
     *
     * @param health Terminus check runner.
     * @param memory Terminus memory indicator.
     * @param healthIndicatorService Terminus factory for custom indicators.
     * @param configService Source of the memory limits.
     * @param databaseHealthIndicatorPort Database ping.
     * @param cacheHealthIndicatorPort Cache ping.
     * @param sessionHealthIndicatorPort Session store ping.
     */
    constructor(
        private readonly health: HealthCheckService,
        private readonly memory: MemoryHealthIndicator,
        private readonly healthIndicatorService: HealthIndicatorService,
        private readonly configService: ConfigService,
        @Inject(TOKEN_DATABASE_HEALTH_PORT)
        private readonly databaseHealthIndicatorPort: IDatabaseHealthPort,
        @Inject(TOKEN_CACHE_HEALTH_PORT) private readonly cacheHealthIndicatorPort: ICacheHealthPort,
        @Inject(TOKEN_SESSION_HEALTH_PORT) private readonly sessionHealthIndicatorPort: ISessionHealthPort,
    ) {}

    /**
     * Runs every indicator through one Terminus check.
     *
     * On failure Terminus throws its raw `ServiceUnavailableException` — deliberately untranslated,
     * the sole exemption to "infrastructure translates". The global filter keys on
     * `instanceof HttpException` to decide what each health path discloses; translating here would
     * put a normalized error body back onto the anonymous readiness probe.
     */
    async getStatus(): Promise<GetHealthStatusResult> {
        return this.toHealthyReadModel(
            await this.health.check([
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
                () => this.checkDependency('database', this.databaseHealthIndicatorPort),
                () => this.checkDependency('cache', this.cacheHealthIndicatorPort),
                () => this.checkDependency('session', this.sessionHealthIndicatorPort),
            ]),
        );
    }

    /**
     * Checks one pingable dependency; a rejected ping marks its indicator down.
     *
     * @param key The indicator the result is reported under.
     * @param port The dependency's health port.
     * @returns The indicator result.
     */
    private async checkDependency(
        key: HealthIndicatorKey,
        port: { ping(): Promise<void> },
    ): Promise<HealthIndicatorResult> {
        const indicator = this.healthIndicatorService.check(key);

        try {
            await port.ping();

            return indicator.up();
        } catch {
            return indicator.down({ message: UnhealthyIndicatorMessage[key] });
        }
    }

    /**
     * Narrows Terminus's wide report into the healthy read model without a type assertion.
     * `check()` throws on any failing indicator, so only a fully-up report can reach this point —
     * anything else is a broken code path and surfaces as 500 + Sentry.
     *
     * @param result The report of a passed check.
     * @returns The healthy read model.
     */
    private toHealthyReadModel(result: HealthCheckResult): GetHealthStatusResult {
        if (result.status !== 'ok') {
            throw new SystemException(`Non-throwing unhealthy Terminus report: "${result.status}".`, {
                context: { class: this.constructor.name, method: this.toHealthyReadModel.name },
            });
        }

        const indicators = {
            memory_heap: this.assertHealthy(result, 'memory_heap'),
            memory_rss: this.assertHealthy(result, 'memory_rss'),
            database: this.assertHealthy(result, 'database'),
            cache: this.assertHealthy(result, 'cache'),
            session: this.assertHealthy(result, 'session'),
        };

        return {
            status: 'ok',
            info: indicators,
            error: {},
            details: indicators,
        };
    }

    /**
     * Narrows one indicator of a passed report to the healthy state.
     *
     * @param result The report of a passed check.
     * @param key The indicator to narrow.
     * @returns The healthy indicator state.
     */
    private assertHealthy(result: HealthCheckResult, key: HealthIndicatorKey): { status: 'up' } {
        if (result.details[key]?.status !== 'up') {
            throw new SystemException(`Indicator "${key}" missing or not up in a passed health check.`, {
                context: { class: this.constructor.name, method: this.assertHealthy.name, key },
            });
        }

        return { status: 'up' };
    }
}
