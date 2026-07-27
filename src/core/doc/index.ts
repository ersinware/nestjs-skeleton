/**
 * @file index.ts
 * @description Public entry point of the doc concern. Nothing outside may import past this barrel.
 */

export * from 'src/core/doc/config/doc.config';
export * from 'src/core/doc/decorator/api-default-access-denied-response.decorator';
export * from 'src/core/doc/decorator/api-default-internal-server-error-response.decorator';
export * from 'src/core/doc/decorator/api-default-invalid-request-response.decorator';
export * from 'src/core/doc/decorator/api-default-ok-response-paginated.decorator';
export * from 'src/core/doc/decorator/api-default-resource-conflict-response.decorator';
export * from 'src/core/doc/decorator/api-default-resource-not-found-response.decorator';
export * from 'src/core/doc/decorator/api-default-unauthenticated-response.decorator';
export * from 'src/core/doc/doc.util';
