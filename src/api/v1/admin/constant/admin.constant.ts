/**
 * @file admin.constant.ts
 * @description Defines dependency injection tokens and domain-specific constants for the admin module. These tokens are used to decouple interfaces from their implementations, promoting inversion of control and testability.
 */

/**
 * The dependency injection token used to resolve the admins repository implementation.
 * Allows the application to inject `IAdminsRepository` without tightly coupling to the actual `AdminsRepository` class.
 */
export const TOKEN_ADMINS_REPOSITORY = Symbol('TOKEN_ADMINS_REPOSITORY');
