import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const PASSWORD_MIN_LENGTH = 8,
    PASSWORD_MAX_LENGTH = 128,
    PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#.+-])[A-Za-z\d@$!%*?&#.+-]{8,}$/;

export function IsStrongPassword(descriptionPrefix: string = 'The password') {
    return applyDecorators(
        ApiProperty({
            type: 'string',
            example: 'Password123!',
            description: `${descriptionPrefix}. Must be at least ${PASSWORD_MIN_LENGTH} characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.`,
            minLength: PASSWORD_MIN_LENGTH,
            maxLength: PASSWORD_MAX_LENGTH,
            pattern: PASSWORD_REGEX.source,
        }),
        IsString(),
        IsNotEmpty(),
        MinLength(PASSWORD_MIN_LENGTH, {
            message: `${descriptionPrefix} must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
        }),
        MaxLength(PASSWORD_MAX_LENGTH, {
            message: `${descriptionPrefix} cannot exceed ${PASSWORD_MAX_LENGTH} characters.`,
        }),
        Matches(PASSWORD_REGEX, {
            message: `${descriptionPrefix} is too weak. It must contain at least one uppercase letter, one lowercase letter, one number, and one special character.`,
        }),
    );
}
