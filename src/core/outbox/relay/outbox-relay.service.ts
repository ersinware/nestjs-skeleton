/**
 * @file outbox-relay.service.ts
 * @description Outbox relay engine: claims dispatchable outbox events and enqueues them onto the
 * BullMQ outbox queue. The single-flight drain loop is inherited from AbstractMessageRelayService;
 * this class only wires the outbox ledger and queue into it.
 */

import { Inject, Injectable } from '@nestjs/common';
import { AbstractMessageRelayService } from 'src/core/messaging';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { OUTBOX_BATCH_SIZE, OUTBOX_LEASE_MS } from 'src/core/outbox/constant';
import { TOKEN_OUTBOX_LEDGER_PORT, type IOutboxLedgerPort } from 'src/core/outbox/port/outbox-ledger.port';
import { TOKEN_OUTBOX_QUEUE_PORT, type IOutboxQueuePort } from 'src/core/outbox/port/outbox-queue.port';
import type { ClaimedOutboxEvent } from 'src/core/outbox/type';

/**
 * Relay engine for the outbox ledger. Claiming uses `FOR UPDATE SKIP LOCKED`, so many instances can
 * run this concurrently without dispatching the same event twice.
 */
@Injectable()
export class OutboxRelayService extends AbstractMessageRelayService<ClaimedOutboxEvent> {
    protected readonly batchSize = OUTBOX_BATCH_SIZE;
    protected readonly leaseMs = OUTBOX_LEASE_MS;

    /**
     * Creates an instance of OutboxRelayService.
     *
     * @param loggerPort - Structured logger.
     * @param outboxLedgerPort - Outbox ledger persistence.
     * @param outboxQueuePort - BullMQ outbox queue.
     */
    constructor(
        @Inject(TOKEN_LOGGER_PORT) loggerPort: ILoggerPort,
        @Inject(TOKEN_OUTBOX_LEDGER_PORT) private readonly outboxLedgerPort: IOutboxLedgerPort,
        @Inject(TOKEN_OUTBOX_QUEUE_PORT) private readonly outboxQueuePort: IOutboxQueuePort,
    ) {
        super(loggerPort);
    }

    /**
     * Claims a batch of dispatchable outbox events with a fresh lease.
     *
     * @param batchSize - Maximum number of events to claim.
     * @param leaseMs - Lease duration in milliseconds to apply to the claimed rows.
     * @returns The claimed events.
     */
    protected claim(batchSize: number, leaseMs: number): Promise<ClaimedOutboxEvent[]> {
        return this.outboxLedgerPort.claimEvents(batchSize, leaseMs);
    }

    /**
     * Enqueues the claimed events onto the BullMQ outbox queue.
     *
     * @param events - The claimed events to enqueue.
     */
    protected dispatch(events: ClaimedOutboxEvent[]) {
        return this.outboxQueuePort.queueEvents(events);
    }
}
