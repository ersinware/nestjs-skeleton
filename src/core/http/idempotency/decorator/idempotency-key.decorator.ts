/**
 * @file idempotency-key.decorator.ts
 * @description Validates the explicit HTTP idempotency key.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { InvalidInputException, InvalidInputMessage } from 'src/shared/exception';

/**
 * Injects a single UUID v4 from Idempotency-Key without changing its value.
 *
 * @throws {InvalidInputException} When the header is absent, repeated, or invalid
 */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
    const value = ctx.switchToHttp().getRequest<FastifyRequest>().headers['idempotency-key'];

    if (typeof value !== 'string' || !isUUID(value, '4')) {
        throw new InvalidInputException(InvalidInputMessage.IDEMPOTENCY_KEY);
    }

    return value;
});
