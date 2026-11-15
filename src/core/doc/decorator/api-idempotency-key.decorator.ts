/**
 * @file api-idempotency-key.decorator.ts
 * @description Swagger decorator documenting the required idempotency key header.
 */

import { ApiHeader } from '@nestjs/swagger';

/**
 * Documents the UUID v4 key and its retry and fingerprint-conflict semantics.
 *
 * @returns A decorator applying the required header metadata to a controller or method.
 */
export function ApiIdempotencyKey(): MethodDecorator & ClassDecorator {
    return ApiHeader({
        name: 'Idempotency-Key',
        required: true,
        description:
            'UUID v4. Reuse the key when retrying the same request; use a new key for a new operation. Reusing a key for a different request returns 409.',
        schema: {
            type: 'string',
            format: 'uuid',
        },
        example: 'b33c6898-66cd-4e12-a8c8-bd20ec7c7f8f',
    });
}
