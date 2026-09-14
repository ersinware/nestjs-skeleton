/**
 * @file api-default-ok-response-paginated.decorator.ts
 * @description Swagger decorator documenting offset-paginated list responses.
 */

import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiProperty, getSchemaPath, IntersectionType, OmitType } from '@nestjs/swagger';
import { ResponsePaginationDto } from 'src/core/http';

/**
 * Documents a 200 response carrying a paginated list of the given DTO model.
 * Builds a named ResponsePaginationDto subclass per model so Swagger and Scalar resolve
 * item schemas and examples instead of showing an untyped list.
 *
 * @param options The response description and the item DTO model.
 * @returns A decorator applying the paginated response metadata to a controller or method.
 */
export function ApiDefaultOkResponsePaginated<T extends Type<unknown>>(options: {
    readonly message: string;
    readonly model: T;
}): MethodDecorator & ClassDecorator {
    const { message, model } = options,
        modelExample = getModelExample(model);

    /**
     * Pagination metadata with the untyped items list omitted.
     */
    class PaginationMetadata extends OmitType(ResponsePaginationDto, ['items'] as const) {}

    /**
     * Items list typed against the given model's schema.
     */
    class PaginatedItems {
        /**
         * The list of items on the current page.
         */
        @ApiProperty({
            type: 'array',
            items: { $ref: getSchemaPath(model) },
            description: 'The list of items on the current page.',
            example: modelExample ? [modelExample] : [],
        })
        readonly items!: readonly unknown[];
    }

    /**
     * Complete paginated response: pagination metadata plus the typed items list.
     */
    class PaginatedResponse extends IntersectionType(PaginationMetadata, PaginatedItems) {}

    Object.defineProperty(PaginatedResponse, 'name', {
        value: `Paginated${model.name.replace(/Dto$/i, '')}`,
    });

    return applyDecorators(
        ApiExtraModels(model, PaginatedResponse),
        ApiOkResponse({
            description: message,
            type: PaginatedResponse,
        }),
    );
}

/**
 * Shape of the Swagger property metadata read via Reflect.
 */
type SwaggerPropertyMetadata = {
    /**
     * The property type: a constructor, or a lazy getter for forward references.
     */
    readonly type?: unknown;

    /**
     * Indicates if the property has an array type.
     */
    readonly isArray?: boolean;

    /**
     * Indicates if the property is a required field.
     */
    readonly required?: boolean;

    /**
     * The raw example value registered on the property.
     */
    readonly example?: unknown;
};

/**
 * Builds an example object for a DTO class from its Swagger property metadata,
 * recursing into nested DTO classes.
 *
 * @param target The DTO constructor to build the example from.
 * @returns The example object, or null when no property yields a value.
 */
function getModelExample(target: Type<unknown>): Record<string, unknown> | null {
    if (!target || !target.prototype) {
        return null;
    }

    const properties = (Reflect.getMetadata('swagger/apiModelPropertiesArray', target.prototype as object) ||
            []) as string[],
        example: Record<string, unknown> = {};

    properties.forEach((propKeyCol: string) => {
        const propKey = propKeyCol.startsWith(':') ? propKeyCol.slice(1) : propKeyCol,
            meta = Reflect.getMetadata('swagger/apiModelProperties', target.prototype as object, propKey) as
                | SwaggerPropertyMetadata
                | undefined;

        if (!meta) {
            return;
        }

        if (meta.example !== undefined) {
            example[propKey] = meta.example;
        } else if (typeof meta.type === 'function') {
            const resolvedType = meta.type.prototype ? meta.type : (meta.type as () => unknown)(),
                nestedExample = getModelExample(resolvedType as Type<unknown>);

            if (nestedExample !== null) {
                example[propKey] = meta.isArray ? [nestedExample] : nestedExample;
            } else {
                example[propKey] = null;
            }
        } else {
            example[propKey] = null;
        }
    });

    return Object.keys(example).length > 0 ? example : null;
}
