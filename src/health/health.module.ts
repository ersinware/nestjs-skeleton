/**
 * @file health.module.ts
 * @description NestJS module configuring health check controllers and indicators using Terminus.
 */

import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Module responsible for orchestrating application health monitoring probes.
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
