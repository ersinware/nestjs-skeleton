import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ACTIVE_VERSIONS, APIVersion, VERSION_CONFIG } from 'src/common/config/documentation.config';

export class SwaggerConfigManager {
    static createDocument(app: INestApplication, version: APIVersion) {
        const document = SwaggerModule.createDocument(app, this.getBuilder(version).build(), {
            ignoreGlobalPrefix: false,
            operationIdFactory: (_, methodKey: string) =>
                version === '1' ? methodKey : `${methodKey}V${version as string}`,
        });

        document.paths = Object.fromEntries(
            Object.entries(document.paths).filter(
                ([path]) =>
                    !ACTIVE_VERSIONS.filter((v) => v !== version).some((v) => path.includes(`/v${v as string}/`)),
            ),
        );

        const schemas = document.components?.schemas;
        if (schemas) {
            for (const schemaName in schemas) {
                const schema = schemas[schemaName] as Record<string, unknown>;
                if (schema['x-force-required']) {
                    schema['required'] = schema['x-force-required'];
                    delete schema['x-force-required'];
                }

                // Align with NestJS forbidNonWhitelisted: true
                if (schema['type'] === 'object') {
                    schema['additionalProperties'] = false;
                }

                // Align Patch schemas with NotEmptyBodyPipe
                if (schemaName.includes('Patch')) {
                    schema['minProperties'] = 1;
                }
            }
        }

        return document;
    }

    static getBuilder(version: APIVersion) {
        const config = VERSION_CONFIG[version],
            builder = new DocumentBuilder()
                .setTitle(config.title)
                .setDescription(config.description)
                .setVersion(`${version}.0.0`)
                .addServer('http://localhost:3000', 'Development server')
                .setContact('API Support', 'admin@digipact.co', 'admin@digipact.co')
                .setLicense('MIT', 'https://opensource.org/licenses/MIT');

        Object.entries(config.tags).forEach(([name, description]) => {
            builder.addTag(name, description);
        });

        return builder;
    }

    static generateStaticScalarHtml(jsonFilename: string, title: string) {
        return `<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <script id="api-reference" data-url="./${jsonFilename}" data-configuration='{ "showOperationId": true }'></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
    }
}
