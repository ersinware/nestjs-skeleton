/**
 * @file auth-test-app.factory.ts
 * @description Test utility helpers and mock trigger controller to facilitate isolated E2E tests for AuthController.
 */

import { Controller, Get } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Roles } from 'src/common/decorator/roles.decorator';
import { AuthUserRole } from 'src/common/guard/enum/auth-user-role.enum';
import { createTestApp } from './test-app.factory';

/**
 * Compiles and initializes a NestJS Fastify testing application with AuthTriggerController registered.
 *
 * @returns A promise resolving to the fully initialized Fastify app instance.
 */
export async function createAuthTestApp(): Promise<NestFastifyApplication> {
    return createTestApp({
        extraControllers: [AuthTriggerController],
    });
}

/**
 * Isolated test controller exposing role-protected endpoints to verify access token permissions.
 */
@Controller('auth-trigger')
export class AuthTriggerController {
    /**
     * Protected endpoint requiring basic authenticated access (any role).
     */
    @Get('protected')
    protectedEndpoint(): void {}

    /**
     * Admin-only protected endpoint.
     */
    @Roles(AuthUserRole.ADMIN)
    @Get('admin-only')
    adminOnlyEndpoint(): void {}

    /**
     * Super Admin-only protected endpoint.
     */
    @Roles(AuthUserRole.SUPER_ADMIN)
    @Get('super-admin-only')
    superAdminOnlyEndpoint(): void {}
}
