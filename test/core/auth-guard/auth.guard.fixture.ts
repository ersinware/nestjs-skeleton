/**
 * @file auth.guard.fixture.ts
 * @description Test utility helpers and mock trigger controller to facilitate isolated E2E tests for AuthGuard.
 */

import { Controller, Get, Req } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AccessTokenPayload, AuthenticatedRequest } from 'src/core/security';
import { Public } from 'src/core/security';
import { createTestApp } from 'test/shared/test-app.factory';

/**
 * Compiles and initializes a NestJS Fastify testing application with AuthGuardTriggerController registered.
 *
 * @returns A promise resolving to the fully initialized Fastify app instance.
 */
export async function createAuthGuardTestApp(): Promise<NestFastifyApplication> {
    return createTestApp({
        extraControllers: [AuthGuardTriggerController],
    });
}

/**
 * Isolated test controller exposing public and protected endpoints to verify AuthGuard behaviors.
 */
@Controller('auth-guard-trigger')
export class AuthGuardTriggerController {
    @Public()
    @Get('public')
    publicEndpoint(): void {}

    /**
     * Protected endpoint that requires a valid access token.
     * Returns the parsed accessTokenPayload attached to the request.
     *
     * @param req The authenticated request.
     * @returns The request payload.
     */
    @Get('protected')
    protectedEndpoint(@Req() req: AuthenticatedRequest): AccessTokenPayload | undefined {
        return req.accessTokenPayload;
    }
}
