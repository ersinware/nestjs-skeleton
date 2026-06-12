/**
 * @file auth-test-app.factory.ts
 * @description Test utility helpers and mock trigger controller to facilitate isolated E2E tests for AuthController.
 */

import { Controller, Get } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Roles } from 'src/common/decorator/auth/roles.decorator';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { createTestApp } from './test-app.factory';
import type { OptionsTestApp } from './interface/e2e-spec.interface';

/**
 * Compiles and initializes a NestJS Fastify testing application with AuthTriggerController registered.
 *
 * @param options Configurations for custom controller registration and module override providers.
 * @returns A promise resolving to the fully initialized Fastify app instance.
 */
export async function createAuthTestApp(options?: OptionsTestApp): Promise<NestFastifyApplication> {
    const config: OptionsTestApp = {
        extraControllers: [AuthTriggerController, ...(options?.extraControllers ?? [])],
    };

    if (options?.overrides) {
        config.overrides = options.overrides;
    }

    return createTestApp(config);
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
