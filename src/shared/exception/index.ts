/**
 * @file index.ts
 * @description Public entry point of the exception concern. Nothing outside may import past this barrel.
 */

export { AccessDeniedException, AccessDeniedMessage } from 'src/shared/exception/access-denied.exception';
export { AppException, isExceptionOfKind, isExceptionWithAudit } from 'src/shared/exception/app.exception';
export type { ExceptionContext } from 'src/shared/exception/app.exception';
export {
    DependencyUnavailableException,
    DependencyUnavailableMessage,
} from 'src/shared/exception/dependency-unavailable.exception';
export { ExceptionKind } from 'src/shared/exception/exception-kind.enum';
export { InvalidInputException, InvalidInputMessage } from 'src/shared/exception/invalid-input.exception';
export { ResourceConflictException, ResourceConflictMessage } from 'src/shared/exception/resource-conflict.exception';
export { ResourceNotFoundException, ResourceNotFoundMessage } from 'src/shared/exception/resource-not-found.exception';
export { SystemException, SystemMessage } from 'src/shared/exception/system.exception';
export { toError } from 'src/shared/exception/to-error.util';
export { UnauthenticatedException, UnauthenticatedMessage } from 'src/shared/exception/unauthenticated.exception';
