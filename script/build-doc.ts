/**
 * @file build-doc.ts
 * @description CLI script to statically compile and export Swagger OpenAPI JSON specs and Scalar HTML files.
 * Used during build time to generate static artifacts for client SDK generation or documentation hosting.
 */

import { Logger as NestLogger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as fs from 'fs';
import { Logger } from 'nestjs-pino';
import * as path from 'path';
import { AppModule } from 'src/app.module';
import { ACTIVE_VERSIONS, VERSION_1 } from 'src/core/config';
import { SwaggerManager, VERSION_CONFIG } from 'src/core/doc';
import { LogPayload } from 'src/core/observability';

/**
 * Scaffolds a minimal application context to inspect NestJS metadata,
 * generates the OpenAPI schema, and saves JSON and HTML output files to the build folder.
 */
async function bootstrap() {
    let app: NestFastifyApplication | undefined;

    function createLogPayload(options: Record<string, unknown>) {
        return new LogPayload({ class: 'build-doc.ts', method: 'bootstrap', ...options });
    }

    try {
        app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
            logger: ['error', 'warn'],
            abortOnError: false,
        });

        const logger = app.get(Logger);

        app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_1 }).setGlobalPrefix('api');

        const docsDir = path.join(process.cwd(), 'dist', 'docs');
        if (!fs.existsSync(docsDir)) {
            fs.mkdirSync(docsDir, { recursive: true });
        }

        ACTIVE_VERSIONS.forEach((version) => {
            const jsonFilename = `swagger-v${version}.json`,
                htmlFilename = `docs-v${version}.html`;

            fs.writeFileSync(
                path.join(docsDir, jsonFilename),
                JSON.stringify(SwaggerManager.createDocument(app!, version), null, 2),
            );
            fs.writeFileSync(
                path.join(docsDir, htmlFilename),
                SwaggerManager.generateStaticScalarHtml(jsonFilename, VERSION_CONFIG[version].title),
            );

            logger.log(createLogPayload({ jsonFilename, htmlFilename }));
        });

        await app.close();
        process.exit(0);
    } catch (error) {
        const _error = error instanceof Error ? error : new Error(String(error));

        try {
            if (!app) {
                throw new Error('App not initialized', { cause: _error });
            }

            app.get(Logger).error(createLogPayload({ error: _error }));
        } catch {
            new NestLogger('BuildSwagger').error(
                createLogPayload({
                    error: _error.message,
                    stack: _error.stack,
                }),
            );
        }

        process.exit(1);
    }
}

void bootstrap();
