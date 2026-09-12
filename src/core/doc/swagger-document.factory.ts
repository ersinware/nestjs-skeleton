/**
 * @file swagger-document.factory.ts
 * @description Builds the OpenAPI (Swagger) document for an API version: filters paths to that
 * version, wraps payloads in the standard success/error envelopes, and aligns component schemas
 * with runtime validation.
 */

import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ACTIVE_VERSIONS, APIVersion } from 'src/core/config';
import { DOC_CONTACT, DOC_LICENSE, DOC_SERVERS, VERSION_CONFIG } from 'src/core/doc/doc.config';

/**
 * Generates the fully processed OpenAPI document for a specific API version.
 *
 * @param app The NestJS application instance.
 * @param version The targeted API version.
 * @returns The processed OpenAPI document.
 */
export function createSwaggerDocument(app: INestApplication, version: APIVersion): OpenAPIObject {
    const document = SwaggerModule.createDocument(app, createSwaggerBuilder(version).build(), {
        ignoreGlobalPrefix: false,
        operationIdFactory: (controllerKey: string, methodKey: string) => {
            // Operation IDs read as [module][Method] (e.g. userCreate) so generated SDK clients
            // get collision-free, clean signatures.
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

    // Wrap success and error responses in the standard envelopes
    wrapResponsePaths(document.paths, componentsSchemas);

    // Align component schemas with runtime validation
    postProcessComponents(componentsSchemas);

    return document;
}

/**
 * Creates a DocumentBuilder pre-populated with the version's metadata from the doc config.
 *
 * @param version The targeted API version.
 * @returns The configured builder.
 */
function createSwaggerBuilder(version: APIVersion): DocumentBuilder {
    const config = VERSION_CONFIG[version],
        builder = new DocumentBuilder()
            .setTitle(config.title)
            .setDescription(config.description)
            .setVersion(`${version}.0.0`)
            .setContact(DOC_CONTACT.name, DOC_CONTACT.url, DOC_CONTACT.email)
            .setLicense(DOC_LICENSE.name, DOC_LICENSE.url)
            .addBearerAuth();

    DOC_SERVERS.forEach(({ url, description }) => {
        builder.addServer(url, description);
    });

    Object.entries(config.tags).forEach(([name, description]) => {
        builder.addTag(name, description);
    });

    return builder;
}

/**
 * Applies the success/error envelopes to every operation response in the document.
 *
 * @param paths OpenAPI paths dictionary.
 * @param componentsSchemas Dictionary of reusable component schemas.
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
 * Wraps one response's JSON schema in the 'data' (success) or 'error' (failure) envelope,
 * matching what ResponseInterceptor and the exception filter emit at runtime.
 *
 * @param response The response configuration object.
 * @param statusCode The HTTP status code of the response.
 * @param componentsSchemas Dictionary of component schemas.
 */
function wrapSingleResponse(response: unknown, statusCode: string, componentsSchemas: Record<string, unknown>) {
    if (!response || typeof response !== 'object') return;

    const _response = response as Record<string, unknown>,
        _statusCode = parseInt(statusCode, 10),
        isSuccessToWrap = _statusCode >= 200 && _statusCode < 300 && _statusCode !== 204,
        isErrorToWrap = _statusCode >= 400 && _statusCode < 600;

    if (!isSuccessToWrap && !isErrorToWrap) return;

    // An error response declared without a schema is body-less (the readiness probe's 503):
    // creating a `content` entry for it would document a JSON body that is never sent.
    const existingSchema = (_response['content'] as Record<string, Record<string, unknown>> | undefined)?.[
        'application/json'
    ]?.['schema'];

    if (isErrorToWrap && !existingSchema) return;

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

    jsonContent['schema'] = buildEnvelope(schemaVal, isSuccessToWrap ? 'data' : 'error', componentsSchemas);
}

/**
 * Builds the standard envelope schema around a payload schema, under a 'data' (success) or
 * 'error' (failure) key. A $ref payload is attached via allOf because sibling keys next to a
 * $ref are ignored by OpenAPI tooling.
 *
 * @param schemaVal The original payload schema or schema reference.
 * @param key The envelope property key.
 * @param componentsSchemas Dictionary of component schemas.
 * @returns The envelope schema object.
 */
function buildEnvelope(schemaVal: unknown, key: 'data' | 'error', componentsSchemas: Record<string, unknown>) {
    const description = key === 'data' ? 'The wrapped response data.' : 'The wrapped error details.',
        example = resolveExample(schemaVal, componentsSchemas),
        hasRef = typeof schemaVal === 'object' && schemaVal !== null && '$ref' in schemaVal,
        property = hasRef
            ? { type: getSchemaType(schemaVal, componentsSchemas), description, example, allOf: [schemaVal] }
            : { ...(schemaVal as Record<string, unknown>), description, example };

    return {
        type: 'object',
        properties: { [key]: property },
        required: [key],
    };
}

/**
 * Resolves a schema's underlying data type, following $ref pointers if necessary.
 *
 * @param schema The schema or schema reference to evaluate.
 * @param componentsSchemas Dictionary of component schemas.
 * @returns The resolved type name (e.g. 'object', 'string').
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
 * Builds an example payload for a schema, following $ref pointers and recursing into
 * arrays and object properties. A oneOf uses its first alternative as the representative example;
 * alternatives are never merged because their discriminators and required fields may conflict.
 *
 * @param schema The schema to inspect.
 * @param componentsSchemas Dictionary of component schemas.
 * @returns An example matching the schema shape, or null when none can be derived.
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

    const alternatives = _schema['oneOf'];
    if (Array.isArray(alternatives) && alternatives.length > 0) {
        return resolveExample(alternatives[0], componentsSchemas);
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
 * Aligns component schemas with runtime validation: forbids extra properties on objects,
 * promotes x-force-required tags, and forces minProperties on PATCH models.
 *
 * @param componentsSchemas Dictionary of component schemas, processed in place.
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
