/**
 * @file test-app.factory.ts
 * @description E2E application factory.
 */

import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { httpCacheHook } from 'src/core/http';
import { auditContextHook } from 'src/core/observability/audit';
import { TOKEN_STORAGE_PORT } from 'src/core/storage';
import type { OptionsTestApp } from 'test/shared/interface/e2e-spec.interface';

/**
 * Initializes the application with E2E routing and provider overrides.
 *
 * @param options Optional controllers and provider overrides.
 * @returns An initialized Fastify application.
 */
export async function createTestApp(options?: OptionsTestApp): Promise<NestFastifyApplication> {
    const builder = Test.createTestingModule({
        imports: [AppModule],
        controllers: [...(options?.extraControllers ?? [])],
    });

    // Fail on unexpected storage use in E2E tests that do not provision S3.
    builder.overrideProvider(TOKEN_STORAGE_PORT).useValue({});

    (options?.overrides ?? []).forEach((override) => {
        builder.overrideProvider(override.provide).useValue(override.useValue);
    });

    const app = (await builder.compile()).createNestApplication<NestFastifyApplication>(
        new FastifyAdapter({ trustProxy: true }),
    );

    app.getHttpAdapter().getInstance().addHook('onRequest', auditContextHook);
    app.getHttpAdapter().getInstance().addHook('onSend', httpCacheHook);

    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.enableShutdownHooks();

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    return app;
}
