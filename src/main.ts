/**
 * @file main.ts
 * @description Application entry point: bootstraps NestJS on Fastify, applies app-wide HTTP configuration, and mounts the Scalar API documentation.
 */

// Mandatory sequence, ahead of every other import: `reflect-metadata` so decorators work at all;
// Sentry so its error hooks exist before any other code can fail; OTel auto-instrumentation before
// the modules it patches at require-time (after Sentry, the composition order Sentry documents).
import 'reflect-metadata';
import 'src/instrument';
import 'src/tracing';

import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { apiReference } from '@scalar/nestjs-api-reference';
import { IncomingMessage, ServerResponse } from 'http';
import { Logger } from 'nestjs-pino';
import { AppModule } from 'src/app.module';
import {
    ACTIVE_VERSIONS,
    ENV,
    GLOBAL_PREFIX,
    resolveTrustProxy,
    ROUTE_DOCS,
    VERSION_1,
    VERSION_PREFIX,
} from 'src/core/config';
import { createSwaggerDocument } from 'src/core/doc';
import { httpCacheHook } from 'src/core/http';
import { auditContextHook } from 'src/core/observability/audit';

/**
 * Bootstraps the application: URI versioning, global prefix, Pino logger, graceful shutdown hooks,
 * and the raw Fastify hooks (audit context, HTTP cache), then starts listening.
 */
async function bootstrap() {
    const app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        // Not `true`: that believes every hop in `X-Forwarded-For`, which is client-written, so it
        // would let a caller choose the `remoteAddress` recorded against it (see resolveTrustProxy).
        new FastifyAdapter({ trustProxy: resolveTrustProxy() }),
        { bufferLogs: true },
    );

    // A raw Fastify hook, not a provider: it must run ahead of the entire Nest pipeline so a
    // request refused by a guard still carries the address it came from.
    app.getHttpAdapter().getInstance().addHook('onRequest', auditContextHook);

    // Raw for the same reason: the `no-store` fallback must reach replies no interceptor sees, and
    // the ETag needs the serialized body.
    app.getHttpAdapter().getInstance().addHook('onSend', httpCacheHook);

    app.enableShutdownHooks()
        .enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_1, prefix: VERSION_PREFIX })
        .setGlobalPrefix(GLOBAL_PREFIX)
        .useLogger(app.get(Logger));

    setupDocumentation(app);

    await app.listen(app.get(ConfigService).getOrThrow<number>(ENV.PORT), '0.0.0.0');
}

/**
 * Registers a Scalar documentation endpoint for each active API version.
 *
 * @param app The application whose Swagger document is generated and served
 */
function setupDocumentation(app: NestFastifyApplication) {
    ACTIVE_VERSIONS.forEach((version) => {
        const path = `/${GLOBAL_PREFIX}/${VERSION_PREFIX}${version}/${ROUTE_DOCS}`;

        // Scalar's handler calls the Express-style `res.send`, which Fastify's raw middleware
        // response lacks — shim it before the handler runs.
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
                content: createSwaggerDocument(app, version),
                showOperationId: true,
                operationsSorter: 'method',
            }),
        );
    });
}

void bootstrap();
