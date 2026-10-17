/**
 * @file build-doc.ts
 * @description Build-time CLI that writes static OpenAPI JSON and Scalar HTML artifacts per active
 * API version, for client SDK generation and documentation hosting.
 */

import { Logger as NestLogger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from 'src/app.module';
import { ACTIVE_VERSIONS, GLOBAL_PREFIX, VERSION_1 } from 'src/core/config';
import { createSwaggerDocument, generateStaticScalarHtml, VERSION_CONFIG } from 'src/core/doc';
import type { LogPayload } from 'src/core/observability/logger';

/**
 * Boots the app (versioning and prefix mirroring main.ts, since they shape the generated paths),
 * generates the OpenAPI document per active version, and writes the artifacts to dist/docs.
 */
async function bootstrap() {
    let app: NestFastifyApplication | undefined;

    try {
        app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
            logger: ['error'],
            abortOnError: false,
            preview: true,
        });

        const logger = new NestLogger('BuildSwagger');

        app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_1 }).setGlobalPrefix(GLOBAL_PREFIX);

        const docsDir = path.join(process.cwd(), 'dist', 'docs');
        if (!fs.existsSync(docsDir)) {
            fs.mkdirSync(docsDir, { recursive: true });
        }

        ACTIVE_VERSIONS.forEach((version) => {
            const jsonFilename = `swagger-v${version}.json`,
                htmlFilename = `docs-v${version}.html`;

            fs.writeFileSync(
                path.join(docsDir, jsonFilename),
                JSON.stringify(createSwaggerDocument(app!, version), null, 2),
            );
            fs.writeFileSync(
                path.join(docsDir, htmlFilename),
                generateStaticScalarHtml(jsonFilename, VERSION_CONFIG[version].title),
            );

            logger.log(
                createLogPayload({
                    message: 'Swagger artifacts written.',
                    data: { jsonFilename, htmlFilename },
                }),
            );
        });

        await app.close();
        process.exit(0);
    } catch (error) {
        const _error = error instanceof Error ? error : new Error(String(error), { cause: error });

        new NestLogger('BuildSwagger').error(createLogPayload({ message: _error.message, error: _error }));

        process.exit(1);
    }

    /**
     * Stamps the script's origin onto a log entry so both loggers emit the same shape.
     *
     * @param entry - The log content to wrap with the script's origin.
     * @returns The origin-stamped payload accepted by both loggers.
     */
    function createLogPayload({
        message,
        error,
        data,
    }: {
        readonly message: string;
        readonly error?: Error;
        readonly data?: Readonly<Record<string, unknown>>;
    }): LogPayload {
        return {
            class: 'build-doc.ts',
            method: bootstrap.name,
            message,
            error,
            ...(data && { data }),
        };
    }
}

void bootstrap();
