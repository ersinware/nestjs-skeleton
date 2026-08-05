/**
 * @file not-empty-body.pipe.ts
 * @description Pipe rejecting requests whose body is missing, empty, or not a plain object.
 */

import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { InvalidInputException } from 'src/shared/exception';

/**
 * Rejects a missing or empty body before field validation runs. `ValidationPipe` alone would
 * accept `{}` against an all-optional DTO, and for required fields would answer an absent body
 * with a list of per-field errors instead of one clear message.
 */
@Injectable()
export class NotEmptyBodyPipe implements PipeTransform {
    /**
     * Passes non-body arguments through and requires a body to be a non-empty plain object.
     *
     * @param value The incoming argument value.
     * @param metadata The metadata identifying which argument kind is being transformed.
     * @returns The value, unchanged.
     * @throws {InvalidInputException} When a body is missing, empty, or not a plain object.
     */
    transform(value: unknown, metadata: ArgumentMetadata): unknown {
        if (metadata.type !== 'body') {
            return value;
        }

        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
            // The message lives here, not in the shared taxonomy: this pipe is its only thrower, so
            // the vocabulary is owned by the guard rail that enforces it.
            throw new InvalidInputException('Request body must be a non-empty plain object.');
        }

        return value;
    }
}
