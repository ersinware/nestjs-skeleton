import { IncomingMessage, ServerResponse } from 'http';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { apiReference } from '@scalar/nestjs-api-reference';
import { ACTIVE_VERSIONS } from 'src/common/config/documentation.config';
import { SwaggerConfigManager } from 'src/common/util/swagger.util';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

    app.enableShutdownHooks();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.setGlobalPrefix('api');

    setupDocumentation(app);

    await app.listen(process.env['PORT'] ?? 3000, '0.0.0.0');
}

function setupDocumentation(app: NestFastifyApplication): void {
    if (process.env['NODE_ENV'] === 'production') {
        return;
    }

    ACTIVE_VERSIONS.forEach((version) => {
        const document = SwaggerConfigManager.createDocument(app, version),
            path = `/api/v${version}/docs`;

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
                spec: { content: document },
                showOperationId: true,
            } as unknown as Parameters<typeof apiReference>[0]),
        );
    });
}

void bootstrap();
