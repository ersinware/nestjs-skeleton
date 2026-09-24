/**
 * @file principal-only.decorator.ts
 * @description Decorator restricting a route to one kind of principal.
 */

import { SetMetadata } from '@nestjs/common';
import type { PrincipalType } from 'src/shared/domain/principal';

/**
 * Metadata key holding the kind of principal a route is restricted to.
 */
export const KEY_DECORATOR_PRINCIPAL_ONLY = 'KEY_DECORATOR_PRINCIPAL_ONLY';

/**
 * Restricts a route to one kind of principal, enforced by `AuthorizationGuard`. Meant for
 * self-scoped routes (`me`), which need no permission but must not answer a token of the other
 * kind: `sub` would otherwise be looked up in the wrong context's table.
 *
 * @param principalType The only kind of principal admitted.
 */
export const PrincipalOnly = (principalType: PrincipalType) => SetMetadata(KEY_DECORATOR_PRINCIPAL_ONLY, principalType);
