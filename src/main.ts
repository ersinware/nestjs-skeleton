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

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from 'src/app.module';
import { configureApplication } from 'src/core/bootstrap';
import { ENV, resolveTrustProxy } from 'src/core/config';

/**
 * Creates the production application, applies shared HTTP configuration and starts listening.
 */
async function bootstrap() {
    const app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        // Trust only configured proxy hops; client-written forwarding headers cannot choose the IP.
        new FastifyAdapter({ trustProxy: resolveTrustProxy() }),
        { bufferLogs: true },
    );

    configureApplication(app);

    await app.listen(app.get(ConfigService).getOrThrow<number>(ENV.PORT), '0.0.0.0');
}

void bootstrap();
