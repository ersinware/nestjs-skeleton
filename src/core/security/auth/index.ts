/**
 * @file index.ts
 * @description Public entry point of the auth concern. Nothing outside may import past this barrel.
 */

export type { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.type';
export { Authenticated } from 'src/core/security/auth/decorator/authenticated.decorator';
export { CurrentPrincipal } from 'src/core/security/auth/decorator/current-principal.decorator';
export { Permissions } from 'src/core/security/auth/decorator/permissions.decorator';
export { PrincipalOnly } from 'src/core/security/auth/decorator/principal-only.decorator';
export { Public } from 'src/core/security/auth/decorator/public.decorator';
export { AuthenticationGuard } from 'src/core/security/auth/guard/authentication.guard';
export { AuthorizationGuard } from 'src/core/security/auth/guard/authorization.guard';
export { AuthPolicyModule } from 'src/core/security/auth/module';
