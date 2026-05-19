import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from 'src/app.module';
import { ACTIVE_VERSIONS, VERSION_CONFIG } from 'src/common/config/documentation.config';
import { SwaggerConfigManager } from 'src/common/util/swagger.util';

async function bootstrap() {
    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.setGlobalPrefix('api');

    const docsDir = path.join(process.cwd(), 'dist', 'docs');
    if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
    }

    ACTIVE_VERSIONS.forEach((version) => {
        const jsonFilename = `swagger-v${version}.json`,
            htmlFilename = `docs-v${version}.html`;

        fs.writeFileSync(
            path.join(docsDir, jsonFilename),
            JSON.stringify(SwaggerConfigManager.createDocument(app, version), null, 2),
        );
        fs.writeFileSync(
            path.join(docsDir, htmlFilename),
            SwaggerConfigManager.generateStaticScalarHtml(jsonFilename, VERSION_CONFIG[version].title),
        );

        console.log(`Generated: dist/docs/${jsonFilename} & dist/docs/${htmlFilename}`);
    });

    await app.close();
    process.exit(0);
}

bootstrap().catch((error) => {
    console.error('Error generating Swagger:', error);

    process.exit(1);
});
