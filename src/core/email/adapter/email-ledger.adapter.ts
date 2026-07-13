/**
 * @file email-ledger.adapter.ts
 * @description Drizzle ORM implementation of the IEmailLedgerPort (durable email intent ledger).
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database/constant/constant';
import { EmailStatus } from 'src/core/email/enum';
import type { IEmailLedgerPort } from 'src/core/email/port';
import { email } from 'src/core/email/schema';
import type { ClaimedEmail, EmailPayload, EmailRecord } from 'src/core/email/type';

/**
 * Drizzle ORM implementation of the email ledger. Handles all database operations for the durable
 * email delivery state machine.
 */
@Injectable()
export class EmailLedgerAdapter implements IEmailLedgerPort {
    /**
     * Creates an instance of EmailLedgerAdapter.
     *
     * @param db - The PostgresJs Drizzle database instance (transaction-aware proxy).
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase) {}

    /**
     * Persists an email intent as a `PENDING` email, ignoring a duplicate `dedupKey`.
     *
     * @param payload - Recipient, subject and body of the email.
     * @param dedupKey - Deterministic idempotency key for the intent.
     * @throws Throws if the database insertion fails.
     */
    async saveEmail(payload: EmailPayload, dedupKey: string) {
        await this.db
            .insert(email)
            .values({ dedupKey, recipient: payload.to, subject: payload.subject, body: payload.body })
            .onConflictDoNothing({ target: email.dedupKey });
    }

    /**
     * Atomically claims a batch of dispatchable emails in a single statement: an inner
     * `SELECT ... FOR UPDATE SKIP LOCKED` picks claimable rows (`PENDING`, or `PROCESSING` with an
     * expired lease) so concurrent relays never grab the same rows, and the outer `UPDATE` moves them
     * to `PROCESSING` with a fresh lease, returning the claimed rows via `RETURNING`. `updated_at` is
     * stamped explicitly here because Drizzle's `$onUpdate` only fires on its query builder, not raw SQL.
     *
     * @param limit - Maximum number of emails to claim.
     * @param leaseMs - Lease duration in milliseconds to apply to the claimed rows.
     * @returns The claimed emails.
     * @throws Throws if the database operation fails.
     */
    async claimEmails(limit: number, leaseMs: number): Promise<ClaimedEmail[]> {
        return this.db.execute<ClaimedEmail>(sql`
            UPDATE ${email}
            SET
                status = ${EmailStatus.PROCESSING},
                available_at = now() + ${leaseMs} * interval '1 millisecond',
                updated_at = now()
            WHERE id IN (
                SELECT id
                FROM ${email}
                WHERE
                    status = ${EmailStatus.PENDING}
                    OR (status = ${EmailStatus.PROCESSING} AND available_at < now())
                ORDER BY id ASC
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id
        `);
    }

    /**
     * Loads the fields the email processor needs to decide whether to send and to build the message.
     *
     * @param id - Email identifier.
     * @returns The email record, or `undefined` if it no longer exists.
     * @throws Throws if the database query fails.
     */
    async getById(id: string): Promise<EmailRecord | null> {
        return (
            (
                await this.db
                    .select({
                        id: email.id,
                        to: email.recipient,
                        subject: email.subject,
                        body: email.body,
                        status: email.status,
                    })
                    .from(email)
                    .where(eq(email.id, id))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Marks an email as sent (terminal success state).
     *
     * @param id - Email identifier.
     * @throws Throws if the database update fails.
     */
    async markSent(id: string) {
        await this.db.update(email).set({ status: EmailStatus.SENT }).where(eq(email.id, id));
    }

    /**
     * Marks an email as dead-lettered after retries are exhausted (terminal failure state).
     *
     * @param id - Email identifier.
     * @throws Throws if the database update fails.
     */
    async markDead(id: string) {
        await this.db.update(email).set({ status: EmailStatus.DEAD }).where(eq(email.id, id));
    }

    /**
     * Deletes `SENT` rows last updated before the given cutoff.
     *
     * @param olderThan - Cutoff timestamp; rows updated before this are removed.
     * @returns The number of rows removed.
     * @throws Throws if the database deletion fails.
     */
    async pruneSent(olderThan: Date): Promise<number> {
        return (
            await this.db
                .delete(email)
                .where(and(eq(email.status, EmailStatus.SENT), lt(email.updatedAt, olderThan)))
                .returning({ id: email.id })
        ).length;
    }
}
