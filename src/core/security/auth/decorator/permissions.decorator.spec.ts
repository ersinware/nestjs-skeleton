/**
 * @file permissions.decorator.spec.ts
 * @description Unit tests for the permission requirement decorator.
 */

import { Permissions } from 'src/core/security/auth/decorator/permissions.decorator';
import { Permission } from 'src/shared/domain/principal';
import { describe, expect, it } from 'vitest';

describe('Permissions', () => {
    it('should reject an empty permission list', () => {
        const permissions = Permissions as (...values: Permission[]) => unknown;

        expect(() => permissions()).toThrow('@Permissions() requires at least one permission.');
    });

    it('should accept one or more permissions', () => {
        expect(() => Permissions(Permission.USER_ACCOUNT_READ)).not.toThrow();
    });
});
