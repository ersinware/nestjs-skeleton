/**
 * @file index.ts
 * @description Public entry point of the shared exception taxonomy. Nothing outside may import past this barrel.
 */

export * from 'src/shared/exception/access-denied.exception';
export * from 'src/shared/exception/app.exception';
export * from 'src/shared/exception/dependency-unavailable.exception';
export * from 'src/shared/exception/exception-kind.enum';
export * from 'src/shared/exception/invalid-input.exception';
export * from 'src/shared/exception/resource-conflict.exception';
export * from 'src/shared/exception/resource-not-found.exception';
export * from 'src/shared/exception/system.exception';
export * from 'src/shared/exception/unauthenticated.exception';
