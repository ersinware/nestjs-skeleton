import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ACTIVE_VERSIONS, APIVersion, VERSION_CONFIG } from 'src/common/config/documentation.config';

export class SwaggerConfigManager {
    /**
     * Creates and post-processes the Swagger OpenAPI document for a specific version.
     * Integrates programmatic data/error response wrapping and schema sanity constraints.
     */
    static createDocument(app: INestApplication, version: APIVersion) {
        const document = SwaggerModule.createDocument(app, this.getBuilder(version).build(), {
            ignoreGlobalPrefix: false,
            operationIdFactory: (_, methodKey: string) =>
                version === '1' ? methodKey : `${methodKey}V${version as string}`,
        });

        // Filter paths to keep only routes belonging to the requested version
        document.paths = Object.fromEntries(
            Object.entries(document.paths).filter(
                ([path]) =>
                    !ACTIVE_VERSIONS.filter((v) => v !== version).some((v) => path.includes(`/v${v as string}/`)),
            ),
        );

        const componentsSchemas = (document.components?.schemas ?? {}) as Record<string, unknown>;

        // 1. Programmatically wrap success and error responses in envelope schemas
        this.wrapResponsePaths(document.paths, componentsSchemas);

        // 2. Adjust and post-process component schemas (restrictions, validations)
        this.postProcessComponents(componentsSchemas);

        return document;
    }

    /**
     * Reusable builder configuration factory for Swagger document creation.
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

        Object.entries(config.tags).forEach(([name, description]) => {
            builder.addTag(name, description);
        });

        return builder;
    }

    /**
     * Iterates over all endpoint paths to identify and wrap responses in global envelopes.
     */
    private static wrapResponsePaths(paths: Record<string, unknown>, componentsSchemas: Record<string, unknown>) {
        if (!paths) return;

        for (const pathKey in paths) {
            const pathItem = paths[pathKey] as Record<string, unknown>;
            if (!pathItem) continue;

            for (const methodKey in pathItem) {
                const operation = pathItem[methodKey] as Record<string, unknown>;
                const responses = operation?.['responses'] as Record<string, unknown>;
                if (!responses) continue;

                for (const statusCode in responses) {
                    this.wrapSingleResponse(responses[statusCode], statusCode, componentsSchemas);
                }
            }
        }
    }

    /**
     * Envelopes a single HTTP response schema in either a success (data) or error (error) wrapper.
     */
    private static wrapSingleResponse(
        response: unknown,
        statusCode: string,
        componentsSchemas: Record<string, unknown>,
    ) {
        if (!response || typeof response !== 'object') return;

        const resObj = response as Record<string, unknown>;
        const statusInt = parseInt(statusCode, 10);
        const isSuccessToWrap = statusInt >= 200 && statusInt < 300 && statusInt !== 204;
        const isErrorToWrap = statusInt >= 400 && statusInt < 600;

        if (!isSuccessToWrap && !isErrorToWrap) return;

        let content = resObj['content'] as Record<string, unknown>;
        if (!content) {
            resObj['content'] = {};
            content = resObj['content'] as Record<string, unknown>;
        }

        let jsonContent = content['application/json'] as Record<string, unknown>;
        if (!jsonContent) {
            content['application/json'] = {};
            jsonContent = content['application/json'] as Record<string, unknown>;
        }

        const schemaVal = jsonContent['schema'] ?? {
            type: 'object',
            nullable: true,
            default: null,
        };

        const hasRef = typeof schemaVal === 'object' && schemaVal !== null && '$ref' in schemaVal;
        const schemaType = getSchemaType(schemaVal, componentsSchemas);
        const schemaExample = resolveExample(schemaVal, componentsSchemas);

        if (isSuccessToWrap) {
            if (hasRef) {
                jsonContent['schema'] = {
                    type: 'object',
                    properties: {
                        data: {
                            type: schemaType,
                            description: 'The wrapped response data.',
                            example: schemaExample,
                            allOf: [schemaVal],
                        },
                    },
                    required: ['data'],
                };
            } else {
                jsonContent['schema'] = {
                    type: 'object',
                    properties: {
                        data: {
                            ...(schemaVal as Record<string, unknown>),
                            description: 'The wrapped response data.',
                            example: schemaExample,
                        },
                    },
                    required: ['data'],
                };
            }
        } else if (jsonContent['schema']) {
            if (hasRef) {
                jsonContent['schema'] = {
                    type: 'object',
                    properties: {
                        error: {
                            type: schemaType,
                            description: 'The wrapped error details.',
                            example: schemaExample,
                            allOf: [schemaVal],
                        },
                    },
                    required: ['error'],
                };
            } else {
                jsonContent['schema'] = {
                    type: 'object',
                    properties: {
                        error: {
                            ...(schemaVal as Record<string, unknown>),
                            description: 'The wrapped error details.',
                            example: schemaExample,
                        },
                    },
                    required: ['error'],
                };
            }
        }
    }

    /**
     * Post-processes standard DTO schemas to apply global API validation rules (e.g. forbid extra properties).
     */
    private static postProcessComponents(componentsSchemas: Record<string, unknown>) {
        for (const schemaName in componentsSchemas) {
            const schema = componentsSchemas[schemaName] as Record<string, unknown>;
            if (!schema) continue;

            // Enforce custom forced fields if declared
            if (schema['x-force-required']) {
                schema['required'] = schema['x-force-required'];
                delete schema['x-force-required'];
            }

            // Align object types with NestJS Validation Pipe forbidNonWhitelisted: true
            if (schema['type'] === 'object') {
                schema['additionalProperties'] = false;
            }

            // Patch schemas must validate that at least one field is provided
            if (schemaName.includes('Patch')) {
                schema['minProperties'] = 1;
            }
        }
    }

    /**
     * Generates standard static HTML reference page for Scalar integration.
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

/**
 * Resolves the underlying primitive or object type of a Swagger schema,
 * recursively following $ref references if necessary.
 */
function getSchemaType(schema: unknown, componentsSchemas: Record<string, unknown>): string {
    if (!schema || typeof schema !== 'object') {
        return 'object';
    }

    const s = schema as Record<string, unknown>;
    const type = s['type'];
    if (typeof type === 'string') {
        return type;
    }

    const ref = s['$ref'];
    if (typeof ref === 'string') {
        const schemaName = ref.split('/').pop();
        if (schemaName) {
            const refSchema = componentsSchemas[schemaName];
            if (refSchema) {
                return getSchemaType(refSchema, componentsSchemas);
            }
        }
    }

    return 'object';
}

/**
 * Dynamically resolves/constructs a sample example object for a given schema,
 * resolving nested properties and $ref references to comply with Spectral schema rules.
 */
function resolveExample(schema: unknown, componentsSchemas: Record<string, unknown>): unknown {
    if (!schema || typeof schema !== 'object') {
        return null;
    }

    const s = schema as Record<string, unknown>;

    const ref = s['$ref'];
    if (typeof ref === 'string') {
        const schemaName = ref.split('/').pop();
        if (schemaName) {
            const refSchema = componentsSchemas[schemaName];
            if (refSchema) {
                return resolveExample(refSchema, componentsSchemas);
            }
        }
    }

    const example = s['example'];
    if (example !== undefined) {
        return example;
    }

    const type = s['type'];
    if (type === 'array') {
        const itemExample = resolveExample(s['items'], componentsSchemas);
        return itemExample !== null ? [itemExample] : [];
    }

    const properties = s['properties'];
    if (type === 'object' && properties && typeof properties === 'object') {
        const props = properties as Record<string, unknown>;
        const objExample: Record<string, unknown> = {};
        for (const propKey in props) {
            objExample[propKey] = resolveExample(props[propKey], componentsSchemas);
        }
        return objExample;
    }

    return null;
}
