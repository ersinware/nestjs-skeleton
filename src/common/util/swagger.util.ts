import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ACTIVE_VERSIONS, APIVersion, VERSION_CONFIG } from 'src/common/config/documentation.config';

export class SwaggerConfigManager {
    /**
     * Creates and filters the OpenAPI document for a specific version.
     */
    static createDocument(app: INestApplication, version: APIVersion) {
        const config = this.getBuilder(version).build(),
            document = SwaggerModule.createDocument(app, config, {
                ignoreGlobalPrefix: false,
                operationIdFactory: (_, methodKey: string) =>
                    version === '1' ? methodKey : `${methodKey}V${version as string}`,
            });

        // Keep only paths that belong to the current version
        // This removes any shared modules' paths that belong to other versions
        document.paths = Object.fromEntries(
            Object.entries(document.paths).filter(([path]) => {
                const otherVersions = ACTIVE_VERSIONS.filter((v) => v !== version);

                return !otherVersions.some((v) => path.includes(`/v${v as string}/`));
            }),
        );

        return document;
    }

    /**
     * Builds the base configuration for a specific API version.
     */
    static getBuilder(version: APIVersion) {
        const config = VERSION_CONFIG[version],
            builder = new DocumentBuilder()
                .setTitle(config.title)
                .setDescription(config.description)
                .setVersion(`${version}.0.0`)
                .addServer('http://localhost:3000', 'Development server')
                .setContact('API Support', 'admin@digipact.co', 'admin@digipact.co')
                .setLicense('MIT', 'https://opensource.org/licenses/MIT');

        // Add version-specific tags
        Object.entries(config.tags).forEach(([name, description]) => {
            builder.addTag(name, description);
        });

        return builder;
    }

    /**
     * Generates a static Scalar HTML wrapper that loads the JSON from a relative path.
     */
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
