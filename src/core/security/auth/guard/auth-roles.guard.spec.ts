/**
 * @file auth-roles.guard.spec.ts
 * @description Unit tests for the RBAC auth roles guard.
 */

import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { KEY_DECORATOR_ROLES } from 'src/core/security/auth/decorator/roles.decorator';
import { AuthRolesGuard } from 'src/core/security/auth/guard/auth-roles.guard';
import { AdminRole } from 'src/shared/domain/admin';
import { UserRole } from 'src/shared/domain/user';
import { AccessDeniedException, AccessDeniedMessage } from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('AuthRolesGuard', () => {
    let guard: AuthRolesGuard, reflector: Reflector;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthRolesGuard,
                {
                    provide: Reflector,
                    useValue: {
                        getAllAndOverride: vi.fn(),
                    },
                },
            ],
        }).compile();

        guard = module.get<AuthRolesGuard>(AuthRolesGuard);
        reflector = module.get<Reflector>(Reflector);
    });

    it('should be defined', () => {
        expect(guard).toBeDefined();
    });

    describe('canActivate', () => {
        const mockHandler = () => {},
            mockClass = class {};

        /**
         * Helper function to build a mock ExecutionContext containing the provided token payload.
         *
         * @param requestPayload Mock payload containing key-value pairs like user role.
         * @returns Mocked NestJS ExecutionContext.
         */
        function createMockContext(requestPayload?: Record<string, unknown>): ExecutionContext {
            return {
                getHandler: vi.fn().mockReturnValue(mockHandler),
                getClass: vi.fn().mockReturnValue(mockClass),
                switchToHttp: vi.fn().mockReturnValue({
                    getRequest: vi.fn().mockReturnValue(requestPayload ? { accessTokenPayload: requestPayload } : {}),
                }),
            } as unknown as ExecutionContext;
        }

        it('should return true if requiredRoles is undefined', () => {
            const spy = vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

            expect(guard.canActivate(createMockContext())).toBe(true);
            expect(spy).toHaveBeenCalledWith(KEY_DECORATOR_ROLES, [mockHandler, mockClass]);
        });

        it('should return true if requiredRoles is empty', () => {
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);

            expect(guard.canActivate(createMockContext())).toBe(true);
        });

        it('should throw AccessDeniedException if request has no accessTokenPayload', () => {
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AdminRole.ADMIN]);

            expect(() => guard.canActivate(createMockContext(undefined))).toThrow(
                new AccessDeniedException(AccessDeniedMessage.DEFAULT),
            );
        });

        it('should throw AccessDeniedException if request has accessTokenPayload but no role', () => {
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AdminRole.ADMIN]);

            expect(() => guard.canActivate(createMockContext({}))).toThrow(
                new AccessDeniedException(AccessDeniedMessage.DEFAULT),
            );
        });

        it('should throw AccessDeniedException if user role is not in the required roles list', () => {
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AdminRole.ADMIN, AdminRole.SUPER_ADMIN]);

            expect(() => guard.canActivate(createMockContext({ role: UserRole.USER }))).toThrow(
                new AccessDeniedException(AccessDeniedMessage.DEFAULT),
            );
        });

        it('should return true if user role is in the required roles list', () => {
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AdminRole.ADMIN]);

            expect(guard.canActivate(createMockContext({ role: AdminRole.ADMIN }))).toBe(true);
        });

        it('should return true if user role matches one of multiple required roles', () => {
            vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AdminRole.ADMIN, AdminRole.SUPER_ADMIN]);

            expect(guard.canActivate(createMockContext({ role: AdminRole.SUPER_ADMIN }))).toBe(true);
        });
    });
});
