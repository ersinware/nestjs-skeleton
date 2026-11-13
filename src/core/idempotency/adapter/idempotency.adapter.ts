/**
 * @file idempotency.adapter.ts
 * @description Coordinates PostgreSQL request claims, atomic mutations, and retained success replay.
 */

import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
    TOKEN_DATABASE_CLIENT,
    TOKEN_TRANSACTION_PORT,
    translateConnectionFailure,
    type ITransactionPort,
} from 'src/core/database';
import { operation } from 'src/core/idempotency/idempotency.schema';
import type {
    IIdempotencyPort,
    IdempotencyRequest,
    IdempotencyResult,
} from 'src/core/idempotency/port/idempotency.port';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import { ResourceConflictException, ResourceConflictMessage, SystemException } from 'src/shared/exception';

/**
 * Separates request fingerprints from other uses of the shared HMAC key.
 */
const POSTGRES_IDEMPOTENCY_FINGERPRINT_CONTEXT = 'postgres:idempotency-fingerprint';

/**
 * Uses PostgreSQL uniqueness to wait for competing claims without distributed locks.
 */
@Injectable()
export class IdempotencyAdapter implements IIdempotencyPort {
    /**
     * Initializes the adapter with existing transaction and hashing capabilities.
     *
     * @param database Primary proxy participating in the ambient transaction
     * @param transactionPort Owns commit and rollback of the entire logical operation
     * @param hashingPort Produces context-separated fingerprints without exposing secrets
     */
    constructor(
        @Inject(TOKEN_DATABASE_CLIENT) private readonly database: NodePgDatabase,
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
    ) {}

    /**
     * Avoids revalidating consumed or expired proofs for retained success while keeping external
     * reads and password work outside the transaction. The final claim settles concurrent callers.
     *
     * @param idempotencyRequest Logical request identity and semantic input
     * @param prepare Read-only preparation without business effects
     * @param work Database mutation using prepared facts
     * @returns Original committed success metadata
     */
    async executePrepared<T>(
        idempotencyRequest: IdempotencyRequest,
        prepare: () => Promise<T>,
        work: (prepared: T) => Promise<IdempotencyResult>,
    ): Promise<IdempotencyResult> {
        let existing;

        try {
            [existing] = await this.database
                .select({ fingerprint: operation.fingerprint, replayResultId: operation.replayResultId })
                .from(operation)
                .where(eq(operation.key, idempotencyRequest.key));
        } catch (error) {
            throw translateConnectionFailure(error);
        }

        if (existing) {
            if (
                existing.fingerprint !==
                this.hashingPort.hmacSha256(POSTGRES_IDEMPOTENCY_FINGERPRINT_CONTEXT, idempotencyRequest.canonicalValue)
            ) {
                throw new ResourceConflictException(ResourceConflictMessage.IDEMPOTENCY_KEY_CONFLICT);
            }

            return { replayResultId: existing.replayResultId };
        }

        let prepared: T;

        try {
            prepared = await prepare();
        } catch (error) {
            // A competing request may have committed while these reads or proofs were evaluated.
            return this.execute(idempotencyRequest, () => {
                throw error;
            });
        }

        return this.execute(idempotencyRequest, () => work(prepared));
    }

    /**
     * Claims and commits new work, or reads the original committed success metadata.
     *
     * @param idempotencyRequest Logical operation identity and canonical semantic input
     * @param work Database mutation, audit, and delivery writes
     * @returns Committed success metadata without repeating work on replay
     */
    async execute(
        idempotencyRequest: IdempotencyRequest,
        work: () => Promise<IdempotencyResult>,
    ): Promise<IdempotencyResult> {
        const fingerprint = this.hashingPort.hmacSha256(
            POSTGRES_IDEMPOTENCY_FINGERPRINT_CONTEXT,
            idempotencyRequest.canonicalValue,
        );

        return this.transactionPort.start(async () => {
            const [claimed] = await this.database
                .insert(operation)
                .values({ key: idempotencyRequest.key, fingerprint })
                .onConflictDoNothing({ target: operation.key })
                .returning({ key: operation.key });

            if (!claimed) {
                const [existing] = await this.database
                    .select({ fingerprint: operation.fingerprint, replayResultId: operation.replayResultId })
                    .from(operation)
                    .where(eq(operation.key, idempotencyRequest.key));

                if (!existing) {
                    throw new SystemException('The conflicting idempotency operation is missing.', {
                        context: { class: this.constructor.name, method: this.execute.name },
                    });
                }

                if (existing.fingerprint !== fingerprint) {
                    throw new ResourceConflictException(ResourceConflictMessage.IDEMPOTENCY_KEY_CONFLICT);
                }

                return { replayResultId: existing.replayResultId };
            }

            const result = await work();

            if (result.replayResultId !== null) {
                await this.database
                    .update(operation)
                    .set({ replayResultId: result.replayResultId })
                    .where(eq(operation.key, idempotencyRequest.key));
            }

            return result;
        });
    }
}
