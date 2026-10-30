/**
 * @file configure-application.ts
 * @description Shared HTTP bootstrap configuration for production and contract-test applications.
 */

import { VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { apiReference } from '@scalar/nestjs-api-reference';
import { IncomingMessage, ServerResponse } from 'http';
import { Logger } from 'nestjs-pino';
import { ACTIVE_VERSIONS, GLOBAL_PREFIX, ROUTE_DOCS, VERSION_1, VERSION_PREFIX } from 'src/core/config';
import { createSwaggerDocument } from 'src/core/doc';
import { httpCacheHook } from 'src/core/http';
import { auditContextHook } from 'src/core/observability/audit';

/**
 * Applies HTTP hooks, routing, logging, shutdown hooks and API documentation before initialization.
 *
 * @param app Application whose providers have been created but whose HTTP server is not initialized.
 */
export function configureApplication(app: NestFastifyApplication) {
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
