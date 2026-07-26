/**
 * @file doc.util.ts
 * @description Utilities for generating, customizing, and post-processing OpenAPI (Swagger) documents.
 * Automates response wrapping in standard success/error envelopes and configures Scalar UI options.
 */

import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ACTIVE_VERSIONS, APIVersion } from 'src/core/config';
import { VERSION_CONFIG } from 'src/core/doc/config/doc.config';

/**
 * Generates and refines the Swagger OpenAPI document for a specific API version.
 * Applies routing path filters, wraps payloads in response envelopes, and post-processes component schemas.
 *
 * @param app The NestJS application instance.
 * @param version The targeted API version for generation.
 * @returns The fully processed OpenAPI document object.
 */
export function createSwaggerDocument(app: INestApplication, version: APIVersion): OpenAPIObject {
    const document = SwaggerModule.createDocument(app, createSwaggerBuilder(version).build(), {
        ignoreGlobalPrefix: false,
        operationIdFactory: (controllerKey: string, methodKey: string) => {
            // Formats the operation ID as [moduleName][FunctionName] (e.g., userCreate, authLogin)
            // to prevent method collisions and ensure clean signatures in generated frontend SDK clients.
            const id = `${controllerKey.replace(/Controller$/, '').replace(/^\w/, (c) => c.toLowerCase())}${methodKey.replace(/^\w/, (c) => c.toUpperCase())}`;

            return version === '1' ? id : `${id}V${version as string}`;
        },
    });

    // Filter paths to keep only routes belonging to the requested version
    document.paths = Object.fromEntries(
        Object.entries(document.paths).filter(
            ([path]) => !ACTIVE_VERSIONS.filter((v) => v !== version).some((v) => path.includes(`/v${v as string}/`)),
        ),
    );

    const componentsSchemas = (document.components?.schemas ?? {}) as Record<string, unknown>;

    // 1. Programmatically wrap success and error responses in envelope schemas
    wrapResponsePaths(document.paths, componentsSchemas);

    // 2. Adjust and post-process component schemas (restrictions, validations)
    postProcessComponents(componentsSchemas);

    return document;
}

/**
 * Creates and configures a DocumentBuilder instance pre-populated with version-specific metadata.
 *
 * @param version The targeted API version.
 * @returns A configured Swagger DocumentBuilder.
 */
function createSwaggerBuilder(version: APIVersion): DocumentBuilder {
    const config = VERSION_CONFIG[version],
        builder = new DocumentBuilder()
            .setTitle(config.title)
            .setDescription(config.description)
            .setVersion(`${version}.0.0`)
            .addServer('http://localhost:3000', 'Development server')
            .setContact('API Support', 'admin@digipact.co', 'admin@digipact.co')
            .setLicense('MIT', 'https://opensource.org/licenses/MIT')
            .addBearerAuth();

    Object.entries(config.tags).forEach(([name, description]) => {
        builder.addTag(name, description);
    });

    return builder;
}

/**
 * Walks through all routes and operations in the document to apply global success and error envelopes.
 *
 * @param paths OpenAPI paths dictionary.
 * @param componentsSchemas Dictionary containing all reusable component schemas.
 */
function wrapResponsePaths(paths: Record<string, unknown>, componentsSchemas: Record<string, unknown>) {
    if (!paths) return;

    Object.keys(paths).forEach((pathKey) => {
        const pathItem = paths[pathKey] as Record<string, unknown>;

        if (!pathItem) return;

        Object.keys(pathItem).forEach((methodKey) => {
            const operation = pathItem[methodKey] as Record<string, unknown>,
                responses = operation?.['responses'] as Record<string, unknown>;

            if (!responses) return;

            Object.keys(responses).forEach((statusCode) => {
                wrapSingleResponse(responses[statusCode], statusCode, componentsSchemas);
            });
        });
    });
}

/**
 * Formats a single HTTP response schema, wrapping it inside a 'data' (success) or 'error' (failure) envelope.
 *
 * @param response The response configuration object.
 * @param statusCode The HTTP status code of the response.
 * @param componentsSchemas Dictionary of all component schemas.
 */
function wrapSingleResponse(response: unknown, statusCode: string, componentsSchemas: Record<string, unknown>) {
    if (!response || typeof response !== 'object') return;

    const _response = response as Record<string, unknown>,
        _statusCode = parseInt(statusCode, 10),
        isSuccessToWrap = _statusCode >= 200 && _statusCode < 300 && _statusCode !== 204,
        isErrorToWrap = _statusCode >= 400 && _statusCode < 600;

    if (!isSuccessToWrap && !isErrorToWrap) return;

    let content = _response['content'] as Record<string, unknown>;
    if (!content) {
        _response['content'] = {};
        content = _response['content'] as Record<string, unknown>;
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

    // Prevent duplicate wrapping if the schema is shared by reference across operations
    if (
        schemaVal &&
        typeof schemaVal === 'object' &&
        'properties' in schemaVal &&
        schemaVal.properties &&
        typeof schemaVal.properties === 'object' &&
        ('data' in schemaVal.properties || 'error' in schemaVal.properties)
    ) {
        return;
    }

    const hasRef = typeof schemaVal === 'object' && schemaVal !== null && '$ref' in schemaVal,
        schemaType = getSchemaType(schemaVal, componentsSchemas),
        schemaExample = resolveExample(schemaVal, componentsSchemas);

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
 * Recursively resolves the underlying data type of a schema, following $ref pointers if necessary.
 *
 * @param schema The schema or schema reference to evaluate.
 * @param componentsSchemas Dictionary of component schemas.
 * @returns The resolved type name (e.g., 'object', 'string').
 */
function getSchemaType(schema: unknown, componentsSchemas: Record<string, unknown>): string {
    if (!schema || typeof schema !== 'object') {
        return 'object';
    }

    const _schema = schema as Record<string, unknown>,
        type = _schema['type'];

    if (typeof type === 'string') {
        return type;
    }

    const ref = _schema['$ref'];
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
 * Recursively extracts or builds an example payload matching the structure of a given schema.
 * Resolves properties and references to ensure validity.
 *
 * @param schema The schema object to inspect.
 * @param componentsSchemas Dictionary of component schemas.
 * @returns An example object representing the schema shape.
 */
function resolveExample(schema: unknown, componentsSchemas: Record<string, unknown>): unknown {
    if (!schema || typeof schema !== 'object') {
        return null;
    }

    const _schema = schema as Record<string, unknown>,
        ref = _schema['$ref'];

    if (typeof ref === 'string') {
        const schemaName = ref.split('/').pop();

        if (schemaName) {
            const refSchema = componentsSchemas[schemaName];

            if (refSchema) {
                return resolveExample(refSchema, componentsSchemas);
            }
        }
    }

    const example = _schema['example'];
    if (example !== undefined) {
        return example;
    }

    const type = _schema['type'];
    if (type === 'array') {
        const itemExample = resolveExample(_schema['items'], componentsSchemas);

        return itemExample !== null ? [itemExample] : [];
    }

    const properties = _schema['properties'];
    if (type === 'object' && properties && typeof properties === 'object') {
        const props = properties as Record<string, unknown>,
            objExample: Record<string, unknown> = {};

        Object.keys(props).forEach((propKey) => {
            objExample[propKey] = resolveExample(props[propKey], componentsSchemas);
        });

        return objExample;
    }

    return null;
}

/**
 * Post-processes component schemas to align Swagger models with class-validator configurations.
 * Forbids extra properties for objects, extracts x-force-required tags, and forces min properties for PATCH models.
 *
 * @param componentsSchemas Dictionary of component schemas to process in-place.
 */
function postProcessComponents(componentsSchemas: Record<string, unknown>) {
    Object.keys(componentsSchemas).forEach((schemaName) => {
        const schema = componentsSchemas[schemaName] as Record<string, unknown>;

        if (!schema) return;

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
    });
}

/**
 * Generates a static HTML template string configured to load Scalar API reference pointing to a local JSON file.
 *
 * @param jsonFilename Name of the static JSON specification file.
 * @param title Title of the documentation webpage.
 * @returns HTML document template string.
 */
export function generateStaticScalarHtml(jsonFilename: string, title: string): string {
    return `<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <script id="api-reference" data-url="./${jsonFilename}" data-configuration='{ "showOperationId": true, "operationsSorter": "method" }'></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
}
