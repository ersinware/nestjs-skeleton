/**
 * @file name.decorator.spec.ts
 * @description Unit tests for the custom name validator decorator.
 */

import { validateSync } from 'class-validator';
import { describe, it, expect } from 'vitest';
import { IsUserName } from './name.decorator';

class TestNameDto {
    @IsUserName('The full name')
    name!: string;
}

describe('IsUserName', () => {
    it('should pass validation for names without numbers or null character', () => {
        ['John Doe', 'Jean-Luc Picard', "Mary O'Donnell", 'Dr. Smith', 'Ahmet Yılmaz', '王伟'].forEach((name) => {
            const dto = new TestNameDto();
            dto.name = name;

            const errors = validateSync(dto);
            expect(errors.length).toBe(0);
        });
    });

    it('should fail validation for names containing numbers', () => {
        ['John1', 'John Doe 3', '12345', 'John Doe 0'].forEach((name) => {
            const dto = new TestNameDto();
            dto.name = name;

            const errors = validateSync(dto);
            expect(errors.length).toBe(1);
        });
    });

    it('should fail validation for names containing the null character', () => {
        const dto = new TestNameDto();
        dto.name = 'John\x00Doe';

        const errors = validateSync(dto);
        expect(errors.length).toBe(1);
    });
});
