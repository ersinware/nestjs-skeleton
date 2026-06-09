/**
 * @file not-empty-body.pipe.ts
 * @description Pipe to enforce non-empty request bodies.
 */

import { BadRequestException, Injectable, PipeTransform, ArgumentMetadata } from '@nestjs/common';
import { BadRequestType } from 'src/common/enum/error/bad-request-type.enum';

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
     * @throws {BadRequestException} if payload is invalid or empty.
     */
    transform(value: unknown, metadata: ArgumentMetadata): unknown {
        if (metadata.type !== 'body') {
            return value;
        }

        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
            throw new BadRequestException(BadRequestType.EMPTY_BODY);
        }

        return value;
    }
}
