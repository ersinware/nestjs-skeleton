/**
 * @file module.spec.ts
 * @description Verifies token concern dependency injection exports.
 */

import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TokenModule } from 'src/core/security/token/module';
import { describe, expect, it } from 'vitest';

describe('TokenModule', () => {
    it('exports JwtService infrastructure', async () => {
        const module = await Test.createTestingModule({
            imports: [TokenModule],
        }).compile();

        try {
            expect(module.get(JwtService)).toBeInstanceOf(JwtService);
        } finally {
            await module.close();
        }
    });
});
