/**
 * @file main.ts
 * @description The main entry point of the application. It is responsible for bootstrapping the NestJS application with the Fastify adapter, establishing global configurations (versioning, global prefix, shutdown hooks, etc.), and setting up the Scalar API documentation. It creates the foundational context required for the application to handle HTTP requests.
 */

import 'reflect-metadata'; // Must be imported before anything else to enable TypeScript decorators
import 'src/instrument'; // Must be the second import to initialize Sentry
import 'src/tracing'; // Must be the absolute first import to initialize OpenTelemetry Auto-Instrumentation

import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { apiReference } from '@scalar/nestjs-api-reference';
import { IncomingMessage, ServerResponse } from 'http';
import { Logger } from 'nestjs-pino';
import { AppModule } from 'src/app.module';
import { ACTIVE_VERSIONS, ENV, GLOBAL_PREFIX, resolveTrustProxy, ROUTE_DOCS, VERSION_1 } from 'src/core/config';
import { createSwaggerDocument } from 'src/core/doc';
import { auditContextHook } from 'src/core/observability/audit';

/**
 * Bootstraps the NestJS application using the Fastify adapter.
 * Configures URI-based versioning, the global API prefix, and the application logger so that the application can accept HTTP traffic. Additionally, it enables shutdown hooks to ensure graceful termination.
 */
async function bootstrap() {
    const app = await NestFactory.create<NestFastifyApplication>(
            AppModule,
            // Not `true`: that believes every hop in `X-Forwarded-For`, which is client-written, so it
            // would let a caller choose the `remoteAddress` recorded against it (see resolveTrustProxy).
            new FastifyAdapter({ trustProxy: resolveTrustProxy() }),
            { bufferLogs: true },
        ),
        configService = app.get(ConfigService);

    // Registered here rather than as a provider because it must run ahead of the entire Nest pipeline —
    // guards included — so that a request refused by a guard still carries the address it came from.
    app.getHttpAdapter().getInstance().addHook('onRequest', auditContextHook);

    app.enableShutdownHooks()
        .enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_1 })
        .setGlobalPrefix(GLOBAL_PREFIX)
        .useLogger(app.get(Logger));

    setupDocumentation(app);

    await app.listen(configService.getOrThrow<number>(ENV.PORT), '0.0.0.0');
}

/**
 * Registers Scalar documentation endpoints for all active API versions.
 * Integrates customized Swagger documents so developers and clients can easily inspect and test the API. It also ensures that response streams are correctly handled under the Fastify environment.
 *
 * @param app The Fastify-based NestJS application instance where the documentation will be configured
 */
function setupDocumentation(app: NestFastifyApplication) {
    ACTIVE_VERSIONS.forEach((version) => {
        const path = `/${GLOBAL_PREFIX}/v${version}/${ROUTE_DOCS}`;

        app.use(
            path,
            (
                _req: IncomingMessage,
                res: ServerResponse & { send?: (body: unknown) => ServerResponse },
                next: () => void,
            ) => {
                if (typeof res.send !== 'function') {
                    res.send = (body: unknown) => {
                        res.end(body as string);

                        return res;
                    };
                }
                next();
            },
        );

        app.use(
            path,
            apiReference({
                spec: { content: createSwaggerDocument(app, version) },
                showOperationId: true,
                operationsSorter: 'method',
            } as unknown as Parameters<typeof apiReference>[0]),
        );
    });
}

void bootstrap();
