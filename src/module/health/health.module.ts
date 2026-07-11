/**
 * @file health.module.ts
 * @description Configures health check controllers and indicators to monitor application stability. It leverages the Terminus module to expose health status endpoints to orchestration tools like Kubernetes or AWS ECS, enabling automated traffic routing away from unhealthy instances.
 */

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TerminusModule } from '@nestjs/terminus';
import {
    GetHealthStatusQueryHandler,
    TOKEN_GET_HEALTH_STATUS_PORT,
} from 'src/module/health/application/query/get-health-status';
import { HealthReaderAdapter } from 'src/module/health/infrastructure/adapter';
import { HealthController } from 'src/module/health/presentation/controller/health.controller';

/**
 * The module responsible for orchestrating application health monitoring probes.
 * It groups the health controller and related services to ensure the application's readiness and liveness can be verified at runtime.
 */
@Module({
    imports: [
        CqrsModule,
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
