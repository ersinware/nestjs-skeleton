/**
 * @file health.module.ts
 * @description Configures health check controllers and indicators to monitor application stability. It leverages the Terminus module to expose health status endpoints to orchestration tools like Kubernetes or AWS ECS, enabling automated traffic routing away from unhealthy instances.
 */

import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * The module responsible for orchestrating application health monitoring probes.
 * It groups the health controller and related services to ensure the application's readiness and liveness can be verified at runtime.
 */
@Module({
    imports: [
        TerminusModule.forRoot({
            logger: false,
        }),
    ],
    controllers: [HealthController],
    providers: [HealthService],
})
export class HealthModule {}
