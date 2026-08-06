/**
 * @file index.ts
 * @description Public entry point of the auth concern. Nothing outside may import past this barrel.
 */

export type { AuthenticatedRequest } from 'src/core/security/auth/authenticated-request.type';
export { CurrentAccessTokenPayload } from 'src/core/security/auth/decorator/current-access-token-payload.decorator';
export { Public } from 'src/core/security/auth/decorator/public.decorator';
export { Roles } from 'src/core/security/auth/decorator/roles.decorator';
export { AuthRolesGuard } from 'src/core/security/auth/guard/auth-roles.guard';
export { AuthGuard } from 'src/core/security/auth/guard/auth.guard';
