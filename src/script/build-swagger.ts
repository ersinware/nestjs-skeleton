/**
 * @file build-swagger.ts
 * @description CLI script to statically compile and export Swagger OpenAPI JSON specs and Scalar HTML files.
 * Used during build time to generate static artifacts for client SDK generation or documentation hosting.
 */

import { VersioningType, Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as fs from 'fs';
import { Logger } from 'nestjs-pino';
import * as path from 'path';
import { AppModule } from 'src/app.module';
import { ACTIVE_VERSIONS, VERSION_CONFIG } from 'src/common/config/documentation.config';
import { SwaggerManager } from 'src/common/util/swagger.util';

/**
 * Scaffolds a minimal application context to inspect NestJS metadata,
 * generates the OpenAPI schema, and saves JSON and HTML output files to the build folder.
 */
async function bootstrap() {
    let app: NestFastifyApplication | undefined;

    try {
        app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });

        const logger = app.get(Logger);

        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' }).setGlobalPrefix('api');

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

            logger.log(
                { class: 'BuildSwagger', method: 'bootstrap', jsonFilename, htmlFilename },
                'Swagger documentation files generated',
            );
        });

        await app.close();
        process.exit(0);
    } catch (error) {
        const _error = error instanceof Error ? error : new Error(String(error));

        try {
            if (!app) {
                throw new Error('App not initialized', { cause: _error });
            }

            app.get(Logger).error(
                { error: _error, class: 'BuildSwagger', method: 'bootstrap' },
                'Error generating Swagger',
            );
        } catch {
            new NestLogger('BuildSwagger').error(
                { error: _error.message, stack: _error.stack, class: 'BuildSwagger', method: 'bootstrap' },
                'Error generating Swagger',
            );
        }

        process.exit(1);
    }
}

void bootstrap();
