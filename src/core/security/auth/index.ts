/**
 * @file index.ts
 * @description Public entry point of the auth concern. Nothing outside may import past this barrel.
 */

export { ACCESS_TOKEN_TYPE, TOKEN_AUTH_ACCESS_TOKEN_PORT } from 'src/core/security/auth/access-token';
export type { AccessTokenPayload } from 'src/core/security/auth/access-token';
export { AccessTokenLifetimePolicy } from 'src/core/security/auth/access-token-lifetime-policy';
export { isPublicAuthPolicy } from 'src/core/security/auth/auth-policy';
export type { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.type';
export { Authenticated } from 'src/core/security/auth/decorator/authenticated.decorator';
export { CurrentPrincipal } from 'src/core/security/auth/decorator/current-principal.decorator';
export { Permissions } from 'src/core/security/auth/decorator/permissions.decorator';
export { PrincipalOnly } from 'src/core/security/auth/decorator/principal-only.decorator';
export { Public } from 'src/core/security/auth/decorator/public.decorator';
export { AuthenticationGuard } from 'src/core/security/auth/guard/authentication.guard';
export { AuthorizationGuard } from 'src/core/security/auth/guard/authorization.guard';
export { AuthPolicyModule } from 'src/core/security/auth/module';
export { REFRESH_TOKEN_TYPE, TOKEN_AUTH_REFRESH_TOKEN_PORT } from 'src/core/security/auth/refresh-token';
export type { RefreshTokenPayload } from 'src/core/security/auth/refresh-token';
