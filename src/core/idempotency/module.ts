/**
 * @file module.ts
 * @description Wires atomic PostgreSQL idempotency with the shared hashing capability.
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/core/database';
import { IdempotencyAdapter } from 'src/core/idempotency/adapter/idempotency.adapter';
import { TOKEN_IDEMPOTENCY_PORT } from 'src/core/idempotency/port/idempotency.port';
import { HashingModule } from 'src/core/security/hashing';

/**
 * Exports the application-facing request idempotency contract.
 */
@Module({
    imports: [DatabaseModule, HashingModule],
    providers: [{ provide: TOKEN_IDEMPOTENCY_PORT, useClass: IdempotencyAdapter }],
    exports: [TOKEN_IDEMPOTENCY_PORT],
})
export class IdempotencyModule {}
