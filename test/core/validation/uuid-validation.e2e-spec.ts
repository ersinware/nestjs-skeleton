/**
 * @file uuid-validation.e2e-spec.ts
 * @description Verifies UUID omission and nullability through the production validation and exception boundaries.
 */

import { Body, Controller, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiSchema } from '@nestjs/swagger';
import { isUUID } from 'src/core/http';
import { Public } from 'src/core/security/auth';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Exercises independent omission and null contracts on UUID fields.
 */
@ApiSchema({ name: 'UuidValidation', description: 'UUID validation fixture.' })
class UuidValidationDto {
    /**
     * Identifier that must always be supplied.
     */
    @isUUID('The required identifier')
    readonly required!: string;

    /**
     * Identifier permitting omission, but rejecting explicit null.
     */
    @isUUID('The optional identifier', { optional: true })
    readonly optional?: string;

    /**
     * Required field permitting explicit null.
     */
    @isUUID('The nullable identifier', { nullable: true })
    readonly nullable!: string | null;

    /**
     * Identifier permitting both omission and explicit null.
     */
    @isUUID('The optional nullable identifier', { optional: true, nullable: true })
    readonly optionalNullable?: string | null;
}

/**
 * Test-only ingress sharing production bootstrap validation.
 */
@Public()
@Controller('uuid-validation')
class UuidValidationController {
    /**
     * Returns only successfully validated input.
     *
     * @param body UUID validation fixture
     * @returns Validated body
     */
    @Post()
    accept(@Body() body: UuidValidationDto): UuidValidationDto {
        return body;
    }
}

describe('UUID validation contracts', () => {
    let app: NestFastifyApplication;
    const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
    beforeAll(async () => {
        app = await createTestApp({ extraControllers: [UuidValidationController] });
    });
    afterAll(async () => {
        await app.close();
    });

    it.each([
        { required: id, nullable: null },
        { required: id, nullable: id, optional: id, optionalNullable: null },
        { required: id, nullable: id, optionalNullable: id },
    ])('accepts explicit valid omission/null combinations: %j', async (payload) => {
        const response = await app.inject({ method: 'POST', url: '/api/v1/uuid-validation', payload });
        expect(response.statusCode).toBe(201);
        expect(response.json<unknown>()).toEqual({ data: payload });
    });

    it.each([
        { nullable: null },
        { required: null, nullable: null },
        { required: id },
        { required: id, nullable: null, optional: null },
        { required: '', nullable: null },
        { required: id, nullable: '', optional: id },
        { required: id, nullable: null, optional: '' },
        { required: id, nullable: null, optionalNullable: '' },
        { required: 'b603fdc2-5c63-4912-b40e-f0bf3b96f156', nullable: null },
    ])('rejects invalid present fields and omitted required fields: %j', async (payload) => {
        const response = await app.inject({ method: 'POST', url: '/api/v1/uuid-validation', payload });
        expect(response.statusCode).toBe(400);
        expect(response.json<unknown>()).toMatchObject({
            error: { statusCode: 400, message: expect.any(Array) as unknown },
        });
    });
});
