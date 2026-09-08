/**
 * @file index.ts
 * @description Public entry point of the principal concern — who may act and what they may do. Nothing outside may import past this barrel.
 */

export { PERMISSION_HOLDER, getHoldablePermissions } from 'src/shared/domain/principal/permission-catalog';
export { Permission } from 'src/shared/domain/principal/permission.enum';
export { PrincipalType } from 'src/shared/domain/principal/principal-type.enum';
export type { Principal } from 'src/shared/domain/principal/principal.type';
