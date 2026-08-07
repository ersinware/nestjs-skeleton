/**
 * @file index.ts
 * @description Public entry point of the doc concern. Nothing outside may import past this barrel.
 */

export { ApiDefaultAccessDeniedResponse } from 'src/core/doc/decorator/api-default-access-denied-response.decorator';
export { ApiDefaultDependencyUnavailableResponse } from 'src/core/doc/decorator/api-default-dependency-unavailable-response.decorator';
export { ApiDefaultInternalServerErrorResponse } from 'src/core/doc/decorator/api-default-internal-server-error-response.decorator';
export { ApiDefaultInvalidRequestResponse } from 'src/core/doc/decorator/api-default-invalid-request-response.decorator';
export { ApiDefaultOkResponsePaginated } from 'src/core/doc/decorator/api-default-ok-response-paginated.decorator';
export { ApiDefaultResourceConflictResponse } from 'src/core/doc/decorator/api-default-resource-conflict-response.decorator';
export { ApiDefaultResourceNotFoundResponse } from 'src/core/doc/decorator/api-default-resource-not-found-response.decorator';
export { ApiDefaultUnauthenticatedResponse } from 'src/core/doc/decorator/api-default-unauthenticated-response.decorator';
export { VERSION_CONFIG } from 'src/core/doc/doc.config';
export { generateStaticScalarHtml } from 'src/core/doc/scalar-static-page.util';
export { createSwaggerDocument } from 'src/core/doc/swagger-document.factory';
