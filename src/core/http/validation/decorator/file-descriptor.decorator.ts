/**
 * @file file-descriptor.decorator.ts
 * @description Composed nested validation and OpenAPI metadata for required file descriptors.
 */

import { applyDecorators, type Type as DtoType } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsObject, ValidateNested } from 'class-validator';

/**
 * Preserves unknown nested fields for the global whitelist rejection while validating the descriptor.
 *
 * @param descriptorDto Workflow-owned DTO defining the descriptor's field rules
 * @param example A schema-valid descriptor example
 * @param descriptionPrefix Field label used in validation messages and documentation
 * @returns A decorator transforming, validating, and documenting a required descriptor
 */
export function IsFileDescriptor(
    descriptorDto: DtoType<unknown>,
    example: Readonly<Record<string, unknown>>,
    descriptionPrefix: string = 'The file descriptor',
): PropertyDecorator {
    return applyDecorators(
        Type(() => descriptorDto),
        IsDefined({ message: `${descriptionPrefix} is required.` }),
        IsObject({ message: `${descriptionPrefix} must be an object.` }),
        ValidateNested({ message: `${descriptionPrefix} must contain valid file details.` }),
        ApiProperty({ type: descriptorDto, description: `${descriptionPrefix}.`, example }),
    );
}
