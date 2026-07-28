/**
 * @file health.module.ts
 * @description Configures health check controllers and indicators to monitor application stability. It leverages the Terminus module to expose health status endpoints to orchestration tools like Kubernetes or AWS ECS, enabling automated traffic routing away from unhealthy instances.
 */

import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CacheModule } from 'src/core/cache';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { SessionModule } from 'src/core/security/session';
import { GetHealthStatusQueryHandler } from 'src/module/health/application/query/get-health-status/handler';
import { TOKEN_GET_HEALTH_STATUS_PORT } from 'src/module/health/application/query/get-health-status/port';
import { HealthReaderAdapter } from 'src/module/health/infrastructure/adapter/health-reader.adapter';
import { HealthController } from 'src/module/health/presentation/controller/health.controller';

/**
 * The module responsible for orchestrating application health monitoring probes.
 * It groups the health controller and related services to ensure the application's readiness and liveness can be verified at runtime.
 */
@Module({
    imports: [
        CqrsPipelineModule,
        DatabaseModule,
        CacheModule,
        SessionModule,
        TerminusModule.forRoot({
            logger: false,
        }),
    ],
    controllers: [HealthController],
    providers: [
        GetHealthStatusQueryHandler,
        {
            provide: TOKEN_GET_HEALTH_STATUS_PORT,
            useClass: HealthReaderAdapter,
        },
    ],
})
export class HealthModule {}
