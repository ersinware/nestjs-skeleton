/**
 * @file not-empty-body.pipe.ts
 * @description Pipe to enforce non-empty request bodies.
 */

import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { BadRequestType } from 'src/common/decorator/enum/bad-request-type.enum';

/**
 * Validates that incoming payload is a non-empty object.
 */
@Injectable()
export class NotEmptyBodyPipe implements PipeTransform {
    /**
     * Validates the request payload.
     *
     * @param value Incoming payload.
     * @returns The validated payload.
     * @throws {BadRequestException} if payload is invalid or empty.
     */
    transform(value: unknown): unknown {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
            throw new BadRequestException(BadRequestType.EMPTY_BODY);
        }

        return value;
    }
}
