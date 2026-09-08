/**
 * @file permission-list.decorator.ts
 * @description Composed decorator bundling validation and OpenAPI metadata for permission-list fields.
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { Permission } from 'src/shared/domain/principal';

/**
 * Single source of the permission-list contract: an array of catalog members with no duplicates.
 * Which members the addressed kind of principal may actually hold is a domain rule the aggregate
 * enforces, not a transport one — this decorator only keeps unknown strings out.
 *
 * @param descriptionPrefix The field label used in the Swagger description and validation error messages.
 * @returns A decorator that validates and documents a permission-list property.
 */
export function IsPermissionList(descriptionPrefix: string = 'The permission list') {
    return applyDecorators(
        IsArray({ message: `${descriptionPrefix} must be an array.` }),
        ArrayUnique({ message: `${descriptionPrefix} cannot contain duplicates.` }),
        IsEnum(Permission, { each: true, message: `${descriptionPrefix} may only contain known permissions.` }),
        ApiProperty({
            type: String,
            isArray: true,
            enum: Permission,
            description: `${descriptionPrefix}.`,
            example: [Permission.USER_ACCOUNT_READ, Permission.USER_ACCOUNT_BAN],
        }),
    );
}
