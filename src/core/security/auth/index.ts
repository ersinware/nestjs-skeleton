/**
 * @file index.ts
 * @description Public entry point of the auth concern. Nothing outside may import past this barrel.
 */

export * from 'src/core/security/auth/auth-role.type';
export * from 'src/core/security/auth/authenticated-request.interface';
export * from 'src/core/security/auth/decorator/access-token-payload.decorator';
export * from 'src/core/security/auth/decorator/public.decorator';
export * from 'src/core/security/auth/decorator/roles.decorator';
export * from 'src/core/security/auth/guard/auth-roles.guard';
export * from 'src/core/security/auth/guard/auth.guard';
