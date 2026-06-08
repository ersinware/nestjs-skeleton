import 'reflect-metadata';
import { Controller, Get, Type } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { describe, it, expect } from 'vitest';
import { ApiDefaultOkResponsePaginated } from './api-default-ok-response-paginated.decorator';

/**
 * Dummy flat DTO used to test Swagger pagination decorator resolution.
 */
class FlatTestDto {
    /**
     * The flat DTO name.
     */
    @ApiProperty({
        type: 'string',
        description: 'The flat DTO name.',
        example: 'John Doe',
    })
    name!: string;
}

/**
 * Dummy nested DTO used to test recursive example resolution inside Swagger pagination decorator.
 */
class NestedTestDto {
    /**
     * The nested property referencing another DTO.
     */
    @ApiProperty({
        type: () => FlatTestDto,
        description: 'The nested property.',
    })
    readonly user!: FlatTestDto;
}

/**
 * Dummy controller used to apply the decorator and verify its effects on method metadata.
 */
@Controller('test')
class TestController {
    /**
     * Dummy endpoint method.
     */
    @Get()
    @ApiDefaultOkResponsePaginated({ description: 'Test pagination description.', type: FlatTestDto })
    findAll() {}
}

/**
 * Internal Swagger response metadata structure for type validation.
 */
interface SwaggerResponseMetadata {
    /**
     * Swagger response description.
     */
    description?: string;
    /**
     * Resolved type schema constructor.
     */
    type?: Type<unknown>;
}

/**
 * Internal Swagger property schema metadata structure for type validation.
 */
interface SwaggerPropertyMetadata {
    /**
     * The property type constructor or type identifier.
     */
    type?: unknown;
    /**
     * Indicates if the property represents an array.
     */
    isArray?: boolean;
    /**
     * Indicates if the property is required.
     */
    required?: boolean;
    /**
     * The documented example value.
     */
    example?: unknown;
    /**
     * The property description text.
     */
    description?: string;
}

describe('ApiDefaultOkResponsePaginated', () => {
    it('should generate the correct dynamic class name and strip the Dto suffix', () => {
        const decorators = ApiDefaultOkResponsePaginated({
            description: 'Success description',
            type: FlatTestDto,
        });
        expect(decorators).toBeDefined();

        const descriptorMock = { value: () => {} };
        decorators(TestController.prototype, 'findAll', descriptorMock);

        const responses = Reflect.getMetadata('swagger/apiResponse', descriptorMock.value) as
            | Record<string, SwaggerResponseMetadata>
            | undefined;
        expect(responses).toBeDefined();

        const okResponse = responses?.['200'];
        expect(okResponse).toBeDefined();
        expect(okResponse?.description).toBe('Success description');

        const paginatedResponseClass = okResponse?.type;
        expect(paginatedResponseClass).toBeDefined();
        expect(paginatedResponseClass?.name).toBe('PaginatedFlatTest');
    });

    it('should resolve metadata examples correctly for flat DTOs', () => {
        const decorators = ApiDefaultOkResponsePaginated({ description: 'Success', type: FlatTestDto }),
            descriptorMock = { value: () => {} };

        decorators(TestController.prototype, 'findAll', descriptorMock);

        const responses = Reflect.getMetadata('swagger/apiResponse', descriptorMock.value) as
                | Record<string, SwaggerResponseMetadata>
                | undefined,
            paginatedResponseClass = responses?.['200']?.type;

        expect(paginatedResponseClass).toBeDefined();

        // Retrieve the metadata of the items property of PaginatedResponse
        const itemsMeta = Reflect.getMetadata(
            'swagger/apiModelProperties',
            (paginatedResponseClass as Type<unknown>).prototype as object,
            'items',
        ) as SwaggerPropertyMetadata | undefined;

        expect(itemsMeta).toBeDefined();
        expect(itemsMeta?.type).toBe('array');
        expect(itemsMeta?.example).toEqual([
            {
                name: 'John Doe',
            },
        ]);
        expect(itemsMeta?.description).toBe('The list of items on the current page.');
    });

    it('should resolve metadata examples recursively for nested DTOs', () => {
        const decorators = ApiDefaultOkResponsePaginated({ description: 'Success', type: NestedTestDto }),
            descriptorMock = { value: () => {} };

        decorators(TestController.prototype, 'findAll', descriptorMock);

        const responses = Reflect.getMetadata('swagger/apiResponse', descriptorMock.value) as
                | Record<string, SwaggerResponseMetadata>
                | undefined,
            paginatedResponseClass = responses?.['200']?.type;

        expect(paginatedResponseClass).toBeDefined();

        const itemsMeta = Reflect.getMetadata(
            'swagger/apiModelProperties',
            (paginatedResponseClass as Type<unknown>).prototype as object,
            'items',
        ) as SwaggerPropertyMetadata | undefined;

        expect(itemsMeta).toBeDefined();
        expect(itemsMeta?.example).toEqual([
            {
                user: {
                    name: 'John Doe',
                },
            },
        ]);
    });
});
