/**
 * @file not-empty-body.pipe.ts
 * @description Pipe to enforce non-empty request bodies.
 */

import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { InvalidInputException } from 'src/shared/exception';

/**
 * Validates that incoming payload is a non-empty object.
 */
@Injectable()
export class NotEmptyBodyPipe implements PipeTransform {
    /**
     * Validates the request payload.
     *
     * @param value Incoming payload.
     * @param metadata Metadata of the validated argument.
     * @returns The validated payload.
     * @throws {InvalidInputException} if payload is invalid or empty.
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
