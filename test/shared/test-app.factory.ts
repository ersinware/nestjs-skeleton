/**
 * @file test-app.factory.ts
 * @description Compiles and bootstraps NestJS Fastify application instances for E2E integration tests.
 */

import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import type { OptionsTestApp } from 'test/shared/interface/e2e-spec.interface';

/**
 * Compiles and initializes a NestJS Fastify application with testing overrides and routing conventions.
 *
 * @param options Configurations for custom controller registration and module override providers.
 * @returns A promise resolving to the fully initialized Fastify app instance.
 */
export async function createTestApp(options?: OptionsTestApp): Promise<NestFastifyApplication> {
    const builder = Test.createTestingModule({
        imports: [AppModule],
        controllers: options?.extraControllers ?? [],
    });

    (options?.overrides ?? []).forEach((override) => {
        builder.overrideProvider(override.provide).useValue(override.useValue);
    });

    const app = (await builder.compile()).createNestApplication<NestFastifyApplication>(
        new FastifyAdapter({ trustProxy: true }),
    );

    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.enableShutdownHooks();

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    return app;
}
