/**
 * @file query.ts
 * @description Read model-less readiness query, mapped to the readiness probe semantics.
 */

import { Query } from '@nestjs/cqrs';

/**
 * Query for dependency readiness that returns only HTTP-level outcome (no body).
 */
export class CheckReadinessQuery extends Query<void> {}
