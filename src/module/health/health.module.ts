/**
 * @file health.module.ts
 * @description Wires the health bounded context: controller, query handler, and the Terminus-backed reader adapter.
 */

import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CacheModule } from 'src/core/cache';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { SessionModule } from 'src/core/security/session';
import { CheckReadinessQueryHandler } from 'src/module/health/application/query/check-readiness/handler';
import { TOKEN_CHECK_READINESS_PORT } from 'src/module/health/application/query/check-readiness/port';
import { GetHealthStatusQueryHandler } from 'src/module/health/application/query/get-health-status/handler';
import { TOKEN_GET_HEALTH_STATUS_PORT } from 'src/module/health/application/query/get-health-status/port';
import { HealthReaderAdapter } from 'src/module/health/infrastructure/adapter/health-reader.adapter';
import { HealthController } from 'src/module/health/presentation/controller/health.controller';

/**
 * Bounded context exposing the liveness, readiness, and detailed health probes.
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
        {
            provide: TOKEN_GET_HEALTH_STATUS_PORT,
            useClass: HealthReaderAdapter,
        },
        {
            provide: TOKEN_CHECK_READINESS_PORT,
            useExisting: TOKEN_GET_HEALTH_STATUS_PORT,
        },
        CheckReadinessQueryHandler,
        GetHealthStatusQueryHandler,
    ],
})
export class HealthModule {}
