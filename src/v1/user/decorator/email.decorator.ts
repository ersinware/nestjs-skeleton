import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

const USER_EMAIL_MIN_LENGTH = 5,
    USER_EMAIL_MAX_LENGTH = 255;

export function IsUserEmail(descriptionPrefix: string = 'The email address') {
    return applyDecorators(
        ApiProperty({
            type: 'string',
            example: 'user@example.com',
            description: `${descriptionPrefix} of the user`,
            format: 'email',
            minLength: USER_EMAIL_MIN_LENGTH,
            maxLength: USER_EMAIL_MAX_LENGTH,
        }),
        IsEmail(),
        IsNotEmpty(),
        MaxLength(USER_EMAIL_MAX_LENGTH, {
            message: `${descriptionPrefix} cannot exceed ${USER_EMAIL_MAX_LENGTH} characters.`,
        }),
    );
}
