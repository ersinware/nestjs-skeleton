/**
 * @file auth-policy.validator.spec.ts
 * @description Real Nest discovery and bootstrap lifecycle coverage without external dependencies.
 */

import { Controller, Get, Scope, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import 'reflect-metadata';
import { Authenticated } from 'src/core/security/auth/decorator/authenticated.decorator';
import { Permissions } from 'src/core/security/auth/decorator/permissions.decorator';
import { PrincipalOnly } from 'src/core/security/auth/decorator/principal-only.decorator';
import { Public } from 'src/core/security/auth/decorator/public.decorator';
import { AuthPolicyModule } from 'src/core/security/auth/module';
import { Permission, PrincipalType } from 'src/shared/domain/principal';
import { SystemException } from 'src/shared/exception';
import { describe, expect, it } from 'vitest';

/**
 * Initializes the production policy module in a component-only Nest context.
 * @param controllers Registered controllers to discover.
 * @returns Completion after bootstrap and resource cleanup.
 */
async function bootstrap(controllers: readonly Type<unknown>[]): Promise<void> {
    const module = await Test.createTestingModule({
        imports: [AuthPolicyModule],
        controllers: [...controllers],
    }).compile();
    try {
        await module.init();
    } finally {
        await module.close();
    }
}

describe('AuthPolicyModule bootstrap', () => {
    it('discovers all valid policy kinds and ignores undecorated helper methods', async () => {
        @Controller('valid')
        class ValidController {
            /** Public GET also verifies RequestMethod.GET = 0 is discovered. */
            @Get('public')
            @Public()
            publicRoute() {}
            /** Authenticated route. */
            @Get('authenticated')
            @Authenticated()
            authenticatedRoute() {}
            /** Principal-specific route. */
            @Get('principal')
            @PrincipalOnly(PrincipalType.USER)
            principalRoute() {}
            /** Permission-specific route. */
            @Get('permission')
            @Permissions(Permission.HEALTH_DETAIL_READ)
            permissionRoute() {}
            /** Not an HTTP endpoint; needs no access policy. */
            helper() {}
        }
        await expect(bootstrap([ValidController])).resolves.toBeUndefined();
    });

    it('rejects an unprotected GET before bootstrap completes', async () => {
        @Controller('missing')
        class MissingController {
            /** Deliberately missing a policy. */
            @Get()
            endpoint() {}
        }
        await expect(bootstrap([MissingController])).rejects.toThrow('MissingController.endpoint');
    });

    it('rejects class/method public conflicts', async () => {
        @Controller('conflict')
        @Permissions(Permission.HEALTH_DETAIL_READ)
        class ConflictingController {
            /** Cannot remove the class protection. */
            @Get()
            @Public()
            endpoint() {}
        }
        await expect(bootstrap([ConflictingController])).rejects.toBeInstanceOf(SystemException);
    });

    it('validates inherited HTTP methods', async () => {
        class BaseController {
            /** Inherited unprotected route. */
            @Get()
            inherited() {}
        }
        @Controller('child')
        class ChildController extends BaseController {}
        await expect(bootstrap([ChildController])).rejects.toThrow('ChildController.inherited');
    });

    it('accepts inherited class protection and method requirements', async () => {
        @Permissions(Permission.ADMIN_ACCOUNT_READ)
        class BaseController {
            /** Inherited restricted route. */
            @Get()
            @Permissions(Permission.ADMIN_ACCOUNT_BAN)
            inherited() {}
        }
        @Controller('child')
        class ChildController extends BaseController {}
        await expect(bootstrap([ChildController])).resolves.toBeUndefined();
    });

    it('detects missing policies in request-scoped controllers without constructing them', async () => {
        let constructions = 0;
        @Controller({ path: 'scoped', scope: Scope.REQUEST })
        class ScopedController {
            /** Construction must not be necessary for metadata validation. */
            constructor() {
                constructions++;
            }
            /** Deliberately unprotected scoped route. */
            @Get()
            endpoint() {}
        }
        await expect(bootstrap([ScopedController])).rejects.toThrow('ScopedController.endpoint');
        expect(constructions).toBe(0);
    });

    it('accepts request-scoped controllers with explicit policies', async () => {
        @Controller({ path: 'scoped', scope: Scope.REQUEST })
        @Authenticated()
        class ScopedController {
            /** Class-protected scoped route. */
            @Get()
            endpoint() {}
        }
        await expect(bootstrap([ScopedController])).resolves.toBeUndefined();
    });

    it('does not let a valid controller hide another invalid controller', async () => {
        @Controller('valid')
        @Public()
        class ValidController {
            /** Public endpoint. */
            @Get()
            endpoint() {}
        }
        @Controller('invalid')
        class InvalidController {
            /** Missing policy. */
            @Get()
            endpoint() {}
        }
        await expect(bootstrap([ValidController, InvalidController])).rejects.toThrow('InvalidController.endpoint');
    });
});
