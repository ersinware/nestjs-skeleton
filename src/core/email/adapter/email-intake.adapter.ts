/**
 * @file email-intake.adapter.ts
 * @description Public intake for asynchronous email. Writes the intent to the durable email ledger
 * first (so it survives a Redis/BullMQ loss), then nudges the relay to dispatch it.
 */

import { Inject, Injectable } from '@nestjs/common';
import { TOKEN_EMAIL_LEDGER_PORT, type IEmailIntakePort, type IEmailLedgerPort } from 'src/core/email/port';
import { EmailRelayService } from 'src/core/email/relay/email-relay.service';
import type { EmailPayload } from 'src/core/email/type';

/**
 * Durable-first email intake. Persisting before dispatch is what makes the email pipeline reliable:
 * even if Redis is unavailable, the intent is safe in Postgres and the relay/cron delivers it later.
 */
@Injectable()
export class EmailIntakeAdapter implements IEmailIntakePort {
    /**
     * Creates an instance of EmailIntakeAdapter.
     *
     * @param emailLedgerPort - Durable email ledger persistence.
     * @param emailRelayService - Shared relay engine that dispatches claimed emails.
     */
    constructor(
        @Inject(TOKEN_EMAIL_LEDGER_PORT) private readonly emailLedgerPort: IEmailLedgerPort,
        private readonly emailRelayService: EmailRelayService,
    ) {}

    /**
     * Records an email intent durably, then triggers an immediate relay pass. The `dedupKey` makes a
     * repeated intake idempotent; a missed nudge is recovered by the fallback cron, so the fire-and-
     * forget drain never risks losing the email.
     *
     * @param data - The email payload containing recipient, subject, and body.
     * @param dedupKey - Deterministic idempotency key for the email intent.
     */
    async queueEmail(data: EmailPayload, dedupKey: string) {
        await this.emailLedgerPort.saveEmail(data, dedupKey);
        void this.emailRelayService.requestDrain();
    }
}
