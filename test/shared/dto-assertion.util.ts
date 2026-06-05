/**
 * @file dto-assertion.util.ts
 * @description Utility assertions and validation wrappers to verify API response schemas against class-validator DTOs.
 */

import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import { expect } from 'vitest';

/**
 * Asserts the shape of an API data response envelope and validates the parsed value against a DTO class structure.
 *
 * @param body Raw API response body.
 * @param cls Target DTO class constructor for schema validation.
 * @returns The validated and instantiated DTO instance.
 */
export function expectDataDto<T>(body: unknown, cls: ClassConstructor<T>): T {
    expect(body).toHaveProperty('data');

    const { dto, errors }: { dto: T; errors: ValidationError[] } = validateDataDto(
        (body as { data: unknown }).data,
        cls,
    );
    expect(errors).toHaveLength(0);

    return dto;
}

/**
 * Instantiates and validates raw response data against a target DTO class structure.
 *
 * @param raw Raw response object.
 * @param cls Target DTO class constructor.
 * @returns Object holding the serialized DTO and array of ValidationErrors.
 */
export function validateDataDto<T>(raw: unknown, cls: ClassConstructor<T>): { dto: T; errors: ValidationError[] } {
    const dto = plainToInstance(cls, raw);

    return { dto, errors: validateSync(dto as object, { whitelist: true, forbidNonWhitelisted: true }) };
}

/**
 * Asserts the shape of an API array response envelope and validates each element against a DTO class.
 *
 * @param body Raw API response body.
 * @param cls Target DTO class constructor.
 * @returns Array of validated DTO instances.
 */
export function expectDataArrayDto<T>(body: unknown, cls: ClassConstructor<T>): T[] {
    expect(body).toHaveProperty('data');

    const data = (body as { data: unknown }).data;
    expect(Array.isArray(data)).toBe(true);

    const { dtos, errors }: { dtos: T[]; errors: ValidationError[] } = validateDataArrayDto(data, cls);
    expect(errors).toHaveLength(0);

    return dtos;
}

/**
 * Validates an array of raw objects against a target class structure.
 *
 * @param raw Raw array source.
 * @param cls Target DTO class constructor.
 * @returns Object holding parsed DTO array and validation errors.
 */
export function validateDataArrayDto<T>(
    raw: unknown,
    cls: ClassConstructor<T>,
): { dtos: T[]; errors: ValidationError[] } {
    if (!Array.isArray(raw)) {
        throw new Error('Raw data is not an array');
    }

    const dtos: T[] = plainToInstance(cls, raw as unknown[]),
        errors: ValidationError[] = [];

    dtos.forEach((dto) => {
        errors.push(...validateSync(dto as object, { whitelist: true, forbidNonWhitelisted: true }));
    });

    return { dtos, errors };
}

/**
 * Asserts the shape of an API error response envelope and validates the schema against a DTO class constructor.
 *
 * @param body Raw API response body.
 * @param cls Target DTO class constructor.
 * @returns The validated and instantiated DTO instance.
 */
export function expectErrorDto<T>(body: unknown, cls: ClassConstructor<T>): T {
    expect(body).toHaveProperty('error');

    const { dto, errors }: { dto: T; errors: ValidationError[] } = validateErrorDto(
        (body as { error: unknown }).error,
        cls,
    );
    expect(errors).toHaveLength(0);

    return dto;
}

/**
 * Instantiates and validates raw error payloads against a target DTO class.
 *
 * @param raw Raw error response payload.
 * @param cls Target error DTO class constructor.
 * @returns Object holding the serialized DTO and validation errors.
 */
export function validateErrorDto<T>(raw: unknown, cls: ClassConstructor<T>): { dto: T; errors: ValidationError[] } {
    const dto: T = plainToInstance(cls, raw);

    return { dto, errors: validateSync(dto as object, { whitelist: true, forbidNonWhitelisted: true }) };
}
