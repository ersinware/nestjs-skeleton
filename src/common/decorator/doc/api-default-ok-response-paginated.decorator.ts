/**
 * @file api-default-ok-response-paginated.decorator.ts
 * @description Custom Swagger decorator to document generic offset-paginated responses.
 */

import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiProperty, getSchemaPath, OmitType, IntersectionType } from '@nestjs/swagger';
import { IsArray } from 'class-validator';
import { ResponsePaginationDto } from 'src/common/dto/response-pagination.dto';

/**
 * Custom Swagger decorator that documents a paginated list of a specific DTO model.
 * Dynamically creates a subclass of ResponsePaginationDto to allow Swagger and Scalar
 * to automatically resolve model examples and schemas.
 * @param options The configuration options including description and DTO model type.
 * @returns A decorator combining ApiExtraModels and ApiOkResponse.
 */
export function ApiDefaultOkResponsePaginated<T extends Type<unknown>>(options: {
    description: string;
    type: T;
}): MethodDecorator & ClassDecorator {
    const { description, type: model } = options,
        modelExample = getModelExample(model);

    /**
     * Dynamic pagination metadata class that omits the raw items list.
     */
    class PaginationMetadata extends OmitType(ResponsePaginationDto, ['items'] as const) {}

    /**
     * Dynamic items wrapper class.
     */
    class PaginatedItems {
        /**
         * The list of items on the current page.
         */
        @IsArray({ message: 'Items must be an array.' })
        @ApiProperty({
            type: 'array',
            items: { $ref: getSchemaPath(model) },
            description: 'The list of items on the current page.',
            example: modelExample ? [modelExample] : [],
        })
        readonly items!: unknown[];
    }

    /**
     * Combined dynamic paginated response intersection type.
     */
    class PaginatedResponse extends IntersectionType(PaginationMetadata, PaginatedItems) {}

    Object.defineProperty(PaginatedResponse, 'name', {
        value: `Paginated${model.name.replace(/Dto$/i, '')}`,
    });

    return applyDecorators(
        ApiExtraModels(ResponsePaginationDto, model, PaginatedResponse),
        ApiOkResponse({
            description,
            type: PaginatedResponse,
        }),
    );
}

/**
 * Swagger model properties metadata structure.
 */
interface SwaggerPropertyMetadata {
    /**
     * The resolved type definition (string constructor or function getter).
     */
    type?: unknown;
    /**
     * Indicates if the property has an array type.
     */
    isArray?: boolean;
    /**
     * Indicates if the property is a required field.
     */
    required?: boolean;
    /**
     * The raw example value registered on the property.
     */
    example?: unknown;
}

/**
 * Extracts a mock example object from a DTO class using Reflect metadata.
 * Resolves properties recursively if nested DTO classes are defined.
 *
 * @param target The target DTO constructor.
 * @returns A mock object representing the class schema.
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
