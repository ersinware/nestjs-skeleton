/**
 * @file uuid-id.decorator.spec.ts
 * @description Verifies UUID validation and OpenAPI metadata for identifier fields.
 */

import { validateSync } from 'class-validator';
import { isUUID } from 'src/core/http/validation/decorator/uuid-id.decorator';
import { describe, expect, it } from 'vitest';

/**
 * Application identifiers default to UUID v7.
 */
class EntityIdDto {
    @isUUID('The entity ID')
    readonly id!: string;
}

/**
 * Pg-boss identifiers accept any UUID version.
 */
class JobIdDto {
    @isUUID('The job ID', { version: 'all' })
    readonly id!: string;
}

/**
 * Nullable IDs remain required but may explicitly be null.
 */
class NullableIdDto {
    @isUUID('The actor ID', { nullable: true })
    readonly id!: string | null;
}

/**
 * Optional IDs may be omitted without becoming nullable in OpenAPI.
 */
class OptionalIdDto {
    @isUUID('The target ID', { optional: true })
    readonly id?: string;
}

/**
 * Validates one DTO property value.
 *
 * @param type DTO class to instantiate
 * @param value Value to validate, or undefined to omit the property
 * @returns Whether the DTO passes validation
 */
function isValid(type: new () => object, value: unknown): boolean {
    return validateSync(Object.assign(new type(), { id: value })).length === 0;
}

/**
 * Reads the composed Swagger property metadata.
 *
 * @param type DTO class containing the identifier
 * @returns Identifier schema metadata
 */
function schemaFor(type: new () => object): Record<string, unknown> {
    return Reflect.getMetadata('swagger/apiModelProperties', type.prototype as object, 'id') as Record<string, unknown>;
}

describe('isUUID', () => {
    const v7 = '018f43c3-6bb3-7d72-911e-848821a837c3';
    const v4 = 'b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f';

    it('requires UUID v7 by default and retains the entity field label', () => {
        expect(isValid(EntityIdDto, v7)).toBe(true);
        expect(isValid(EntityIdDto, v4)).toBe(false);
        expect(isValid(EntityIdDto, '')).toBe(false);
        expect(isValid(EntityIdDto, undefined)).toBe(false);
        expect(schemaFor(EntityIdDto)).toMatchObject({ format: 'uuid', description: 'The entity ID.', example: v7 });
    });

    it('accepts pg-boss UUID versions but rejects malformed identifiers', () => {
        expect(isValid(JobIdDto, v7)).toBe(true);
        expect(isValid(JobIdDto, v4)).toBe(true);
        expect(isValid(JobIdDto, 'not-a-uuid')).toBe(false);
        expect(schemaFor(JobIdDto)).toMatchObject({ format: 'uuid', example: v4 });
    });

    it('accepts explicit null only for nullable fields while keeping them required', () => {
        expect(isValid(NullableIdDto, null)).toBe(true);
        expect(isValid(NullableIdDto, undefined)).toBe(false);
        expect(isValid(NullableIdDto, '')).toBe(false);
        expect(schemaFor(NullableIdDto)).toMatchObject({ nullable: true });
        expect(schemaFor(NullableIdDto)['required']).not.toBe(false);
    });

    it('permits omitted optional fields and documents them as not required', () => {
        expect(isValid(OptionalIdDto, undefined)).toBe(true);
        expect(isValid(OptionalIdDto, v7)).toBe(true);
        expect(isValid(OptionalIdDto, '')).toBe(false);
        expect(schemaFor(OptionalIdDto)).toMatchObject({ required: false });
        expect(schemaFor(OptionalIdDto)['nullable']).not.toBe(true);
    });
});
