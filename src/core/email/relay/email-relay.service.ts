/**
 * @file email-relay.service.ts
 * @description Email relay engine: claims dispatchable emails from the durable ledger and enqueues
 * them onto the BullMQ email queue. The single-flight drain loop is inherited from
 * AbstractMessageRelayService; this class only wires the email ledger and queue into it.
 */

import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_BATCH_SIZE, EMAIL_LEASE_MS } from 'src/core/email/constant';
import { TOKEN_EMAIL_LEDGER_PORT, type IEmailLedgerPort } from 'src/core/email/port/email-ledger.port';
import { TOKEN_EMAIL_QUEUE_PORT, type IEmailQueuePort } from 'src/core/email/port/email-queue.port';
import type { ClaimedEmail } from 'src/core/email/type';
import { AbstractMessageRelayService } from 'src/core/messaging';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';

/**
 * Relay engine for the email ledger. Claiming uses `FOR UPDATE SKIP LOCKED`, so many instances can run
 * this concurrently without dispatching the same email twice.
 */
@Injectable()
export class EmailRelayService extends AbstractMessageRelayService<ClaimedEmail> {
    protected readonly batchSize = EMAIL_BATCH_SIZE;
    protected readonly leaseMs = EMAIL_LEASE_MS;

    /**
     * Creates an instance of EmailRelayService.
     *
     * @param loggerPort - Structured logger.
     * @param emailLedgerPort - Email ledger persistence.
     * @param emailQueuePort - BullMQ email queue.
     */
    constructor(
        @Inject(TOKEN_LOGGER_PORT) loggerPort: ILoggerPort,
        @Inject(TOKEN_EMAIL_LEDGER_PORT) private readonly emailLedgerPort: IEmailLedgerPort,
        @Inject(TOKEN_EMAIL_QUEUE_PORT) private readonly emailQueuePort: IEmailQueuePort,
    ) {
        super(loggerPort);
    }

    /**
     * Claims a batch of dispatchable emails with a fresh lease.
     *
     * @param batchSize - Maximum number of emails to claim.
     * @param leaseMs - Lease duration in milliseconds to apply to the claimed rows.
     * @returns The claimed emails.
     */
    protected claim(batchSize: number, leaseMs: number): Promise<ClaimedEmail[]> {
        return this.emailLedgerPort.claimEmails(batchSize, leaseMs);
    }

    /**
     * Enqueues the claimed emails onto the BullMQ email queue.
     *
     * @param emails - The claimed emails to enqueue.
     */
    protected dispatch(emails: ClaimedEmail[]) {
        return this.emailQueuePort.queueEmails(emails);
    }
}
