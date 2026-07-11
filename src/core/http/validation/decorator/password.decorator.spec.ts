/**
 * @file password.decorator.spec.ts
 * @description Unit tests for the custom strength-validating password decorator.
 */

import { validateSync } from 'class-validator';
import { IsStrongPassword } from 'src/core/http/validation/decorator/password.decorator';
import { describe, expect, it } from 'vitest';

class TestPasswordDto {
    @IsStrongPassword('The password')
    password!: string;
}

describe('IsStrongPassword', () => {
    it('should pass validation for strong passwords matching the regex requirements', () => {
        [
            'Password123!',
            'StrongPass.99',
            'aB1+cD2-',
            'Admin#2026',
            'Password123!_',
            'Password123',
            'Password123!=',
        ].forEach((password) => {
            const dto = new TestPasswordDto();
            dto.password = password;

            const errors = validateSync(dto);
            expect(errors.length).toBe(0);
        });
    });

    it('should fail validation if there is no uppercase letter', () => {
        const dto = new TestPasswordDto();
        dto.password = 'password123!';

        const errors = validateSync(dto);
        expect(errors.length).toBe(1);
    });

    it('should fail validation if there is no lowercase letter', () => {
        const dto = new TestPasswordDto();
        dto.password = 'PASSWORD123!';

        const errors = validateSync(dto);
        expect(errors.length).toBe(1);
    });

    it('should fail validation if there is no digit', () => {
        const dto = new TestPasswordDto();
        dto.password = 'Password!!!';

        const errors = validateSync(dto);
        expect(errors.length).toBe(1);
    });
});
