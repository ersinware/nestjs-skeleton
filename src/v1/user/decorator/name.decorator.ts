import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const USER_NAME_MIN_LENGTH = 2,
    USER_NAME_MAX_LENGTH = 100,
    USER_NAME_REGEX = /^[^0-9]+$/;

export function IsUserName(descriptionPrefix: string = 'The full name') {
    return applyDecorators(
        ApiProperty({
            type: 'string',
            example: 'John Doe',
            description: `${descriptionPrefix} of the user`,
            minLength: USER_NAME_MIN_LENGTH,
            maxLength: USER_NAME_MAX_LENGTH,
            pattern: USER_NAME_REGEX.source,
        }),
        IsString(),
        IsNotEmpty(),
        MinLength(USER_NAME_MIN_LENGTH, {
            message: `${descriptionPrefix} must be at least ${USER_NAME_MIN_LENGTH} characters long.`,
        }),
        MaxLength(USER_NAME_MAX_LENGTH, {
            message: `${descriptionPrefix} cannot exceed ${USER_NAME_MAX_LENGTH} characters.`,
        }),
        Matches(USER_NAME_REGEX, {
            message: `${descriptionPrefix} must not contain numbers.`,
        }),
    );
}
