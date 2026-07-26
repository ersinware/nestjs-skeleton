/**
 * @file health.controller.ts
 * @description Exposes the health surface as three endpoints with three different audiences: a dependency-free liveness probe, a dependency-checking readiness probe, and a detailed operator view. Standard rate-limiting is bypassed throughout so automated probes are never blocked under high traffic conditions.
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
import { SkipThrottle } from '@nestjs/throttler';
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
 * The controller exposing the operational state of the service and its dependencies.
 *
 * The surface is split by AUDIENCE, not by convenience. An orchestrator asks two questions that must
 * never share an answer: "should this process be restarted" (liveness) and "should this instance
 * receive traffic" (readiness). Answering liveness with a dependency check turns a Redis or Postgres
 * outage into a restart storm across every otherwise-healthy instance, so the liveness probe touches
 * nothing.
 *
 * Both probes are public but answer with a bare status code, because a body would publish the
 * infrastructure topology and the currently failing dependency to any anonymous caller. The detailed
 * view carries exactly that information, so it is restricted to super admins.
 */
@Controller({
    path: ROUTE_HEALTH,
    version: VERSION_NEUTRAL,
})
@SkipThrottle()
@ApiTags('health')
@ApiDefaultInternalServerErrorResponse()
export class HealthController {
    /**
     * Injects the query pipeline to execute health check queries. The health query is deliberately
     * non-cacheable, so the pipeline passes it straight through to the handler — routing every edge
     * through the pipeline keeps the "no query bypasses the behavior chain" invariant intact.
     *
     * @param queryPipeline The CQRS query pipeline.
     */
    constructor(private readonly queryPipeline: QueryPipeline) {}

    /**
     * Answers whether this process is alive at all — the question a `livenessProbe` acts on by
     * restarting the container. It deliberately checks NO dependency: a downed database or cache is
     * not repaired by killing healthy instances, and treating it as a liveness failure would take the
     * whole deployment down with the dependency. Reaching this method IS the answer, so there is no
     * use case to dispatch and, uniquely on this controller, no pipeline call.
     */
    @Get(ROUTE_HEALTH_LIVE)
    @Public()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Liveness probe',
        description:
            'Reports whether the process is running and able to answer HTTP. Checks no dependency, so it never fails because of an outage elsewhere. Empty body by design — the status code is the whole answer.',
    })
    @ApiNoContentResponse({ description: 'The process is alive.' })
    checkLiveness() {}

    /**
     * Answers whether this instance can serve traffic right now — the question a `readinessProbe` and
     * the container `HEALTHCHECK` act on by routing traffic away, without restarting anything. It
     * runs the full dependency check but discards the detail: the caller is a load balancer that
     * branches on the status code, and the endpoint is unauthenticated.
     *
     * @throws {ServiceUnavailableException} If one or more health indicators fail; the global filter
     * turns it into a bare 503.
     */
    @Get(ROUTE_HEALTH_READY)
    @Public()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Readiness probe',
        description:
            'Reports whether the instance can serve traffic, verifying memory headroom, database and cache connectivity. Empty body by design — the status code is the whole answer, and the failing dependency is never disclosed to an anonymous caller.',
    })
    @ApiNoContentResponse({ description: 'The instance is ready to serve traffic.' })
    @ApiServiceUnavailableResponse({ description: DependencyUnavailableMessage.DEFAULT })
    async checkReadiness() {
        await this.queryPipeline.execute(new GetHealthStatusQuery());
    }

    /**
     * Reports the per-indicator health detail an operator needs to tell WHICH dependency failed.
     * Restricted to super admins: the payload names the application's dependencies and their current
     * state, which is reconnaissance material for anyone else.
     *
     * @returns The resolved health check result payload containing the status of all evaluated indicators
     * @throws {ServiceUnavailableException} If one or more health indicators fail; the global filter
     * passes the raw indicator output through.
     */
    @Get()
    @Roles(AdminRole.SUPER_ADMIN)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Detailed health status',
        description:
            'Returns the per-indicator health status of the API service and its dependencies. Restricted to super admins because it discloses the dependency topology.',
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
