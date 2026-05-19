import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, HealthIndicatorService, MemoryHealthIndicator } from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE_DB } from 'src/database/constant';

@Injectable()
export class HealthService {
    constructor(
        private readonly health: HealthCheckService,
        private readonly memory: MemoryHealthIndicator,
        private readonly healthIndicatorService: HealthIndicatorService,
        private readonly configService: ConfigService,
        @Inject(DRIZZLE_DB) private readonly db: PostgresJsDatabase,
    ) {}

    async check() {
        return this.health.check([
            () =>
                this.memory.checkHeap(
                    'memory_heap',
                    this.configService.getOrThrow<number>('HEALTH_HEAP_LIMIT_MB') * 1024 * 1024,
                ),
            () =>
                this.memory.checkRSS(
                    'memory_rss',
                    this.configService.getOrThrow<number>('HEALTH_RSS_LIMIT_MB') * 1024 * 1024,
                ),
            () => this.checkDatabase(),
        ]);
    }

    private async checkDatabase() {
        const indicator = this.healthIndicatorService.check('database');

        try {
            await this.db.execute(sql`SELECT 1`);

            return indicator.up();
        } catch {
            return indicator.down({ message: 'Database connection failed.' });
        }
    }
}
