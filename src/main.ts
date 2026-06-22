/**
 * @file main.ts
 * @description Application entry point. Configures Fastify, API versioning, routes, and Scalar API documentation.
 */

import './tracing'; // Must be the absolute first import to initialize OpenTelemetry Auto-Instrumentation
import './instrument'; // Must be the second import to initialize Sentry

import { IncomingMessage, ServerResponse } from 'http';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { apiReference } from '@scalar/nestjs-api-reference';
import { Logger } from 'nestjs-pino';
import { ACTIVE_VERSIONS } from 'src/common/config/documentation.config';
import { ENV } from 'src/common/config/constant/env.constant';
import { SwaggerManager } from 'src/common/util/swagger.util';
import { AppModule } from './app.module';

/**
 * Initializes and starts the NestJS application with the Fastify adapter.
 * Sets up global configurations such as URI-based versioning, API prefix, shutdown hooks, and runs the listener.
 */
async function bootstrap() {
    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
            bufferLogs: true,
        }),
        configService = app.get(ConfigService);

    app.enableShutdownHooks()
        .enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
        .setGlobalPrefix('api')
        .useLogger(app.get(Logger));

    setupDocumentation(app);

    await app.listen(configService.getOrThrow<number>(ENV.PORT), '0.0.0.0');
}

/**
 * Registers Scalar documentation endpoints for all active API versions.
 * Integrates customized Swagger documents and ensures response streams are handled correctly under Fastify.
 *
 * @param app The NestJS application instance using Fastify.
 */
function setupDocumentation(app: NestFastifyApplication) {
    ACTIVE_VERSIONS.forEach((version) => {
        const path = `/api/v${version}/docs`;

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
                spec: { content: SwaggerManager.createDocument(app, version) },
                showOperationId: true,
                operationsSorter: 'method',
            } as unknown as Parameters<typeof apiReference>[0]),
        );
    });
}

void bootstrap();
