/**
 * @file health.controller.ts
 * @description Exposes the health surface: a dependency-free liveness probe, a dependency-checking readiness probe, and a detailed operator view.
 */

import { Controller, Get, HttpCode, HttpStatus, VERSION_NEUTRAL } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiNoContentResponse,
    ApiOkResponse,
    ApiOperation,
    ApiServiceUnavailableResponse,
    ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { ROUTE_HEALTH, ROUTE_HEALTH_LIVE, ROUTE_HEALTH_READY } from 'src/core/config';
import { QueryPipeline } from 'src/core/cqrs';
import {
    ApiDefaultAccessDeniedResponse,
    ApiDefaultInternalServerErrorResponse,
    ApiDefaultUnauthenticatedResponse,
} from 'src/core/doc';
import { Public, Roles } from 'src/core/security/auth';
import { GetHealthStatusQuery } from 'src/module/health/application/query/get-health-status/query';
import { ResponseHealthyDto } from 'src/module/health/presentation/dto/response-healthy.dto';
import { ResponseUnhealthyDto } from 'src/module/health/presentation/dto/response-unhealthy.dto';
import { AdminRole } from 'src/shared/domain/admin';
import { DependencyUnavailableMessage } from 'src/shared/exception';

/**
 * Exposes the operational state of the service, split by audience: liveness ("restart this
 * process?") and readiness ("route traffic here?") must never share an answer, or a dependency
 * outage restarts every healthy instance. Both probes are public and body-less — a body would
 * disclose the dependency topology to anonymous callers; the detailed view carries exactly that
 * information and is therefore restricted to super admins.
 */
@Controller({
    path: ROUTE_HEALTH,
    version: VERSION_NEUTRAL,
})
@ApiTags('health')
@ApiDefaultInternalServerErrorResponse()
export class HealthController {
    /**
     * Creates the controller.
     *
     * @param queryPipeline The CQRS query pipeline; the health query is non-cacheable, but every edge still dispatches through the pipeline.
     */
    constructor(private readonly queryPipeline: QueryPipeline) {}

    /**
     * Liveness probe. Deliberately checks no dependency — restarting instances does not repair a
     * downed database or cache. Reaching this method IS the answer, so no use case is dispatched.
     */
    @Get(ROUTE_HEALTH_LIVE)
    @Public()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Liveness probe',
        description: 'Reports whether the process is alive. Checks no dependency; the status code is the whole answer.',
    })
    @ApiNoContentResponse({ description: 'The process is alive.' })
    checkLiveness() {}

    /**
     * Readiness probe. Runs the full dependency check but discards the detail: the caller branches
     * on the status code, and the endpoint is unauthenticated.
     *
     * @throws {ServiceUnavailableException} When any indicator fails; the global filter turns it into a bare 503.
     */
    @Get(ROUTE_HEALTH_READY)
    @Public()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Readiness probe',
        description:
            'Reports whether the instance can serve traffic, checking every dependency. The status code is the whole answer; the failing dependency is never disclosed.',
    })
    @ApiNoContentResponse({ description: 'The instance is ready to serve traffic.' })
    @ApiServiceUnavailableResponse({ description: DependencyUnavailableMessage.DEFAULT })
    async checkReadiness() {
        await this.queryPipeline.execute(new GetHealthStatusQuery());
    }

    /**
     * Per-indicator health detail, naming which dependency failed. Restricted to super admins —
     * the payload is reconnaissance material for anyone else.
     *
     * @returns The status of every indicator.
     * @throws {ServiceUnavailableException} When any indicator fails; the global filter passes the indicator report through.
     */
    @Get()
    @Roles(AdminRole.SUPER_ADMIN)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Detailed health status',
        description:
            'Returns the per-indicator health status of the service and its dependencies. Requires super-administrator authorization.',
    })
    @ApiOkResponse({
        description: 'Service is fully healthy.',
        type: ResponseHealthyDto,
    })
    @ApiServiceUnavailableResponse({
        description: DependencyUnavailableMessage.DEFAULT,
        type: ResponseUnhealthyDto,
    })
    @ApiDefaultUnauthenticatedResponse()
    @ApiDefaultAccessDeniedResponse()
    async getStatus(): Promise<ResponseHealthyDto> {
        return plainToInstance(ResponseHealthyDto, await this.queryPipeline.execute(new GetHealthStatusQuery()));
    }
}
