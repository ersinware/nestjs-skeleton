/**
 * @file prune.cron.ts
 * @description Cron that prunes inbox dedup markers past their retention window, keeping the ledger
 * bounded while preserving markers long enough that a still-redeliverable event stays deduplicated.
 */

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ENV } from 'src/core/config';
import { INBOX_LEDGER_RETENTION_MS } from 'src/core/inbox-ledger/constant';
import { TOKEN_INBOX_LEDGER_PORT, type IInboxLedgerPort } from 'src/core/inbox-ledger/port';

/**
 * Scheduled cleanup for the inbox dedup ledger. Removes markers once they age past the retention
 * window, which is derived to always outlast the redelivery lifetime of their source events.
 */
@Injectable()
export class InboxLedgerPruneCron implements OnModuleInit {
    /**
     * Creates an instance of InboxLedgerPruneCron.
     *
     * @param ledgerPort - Inbox ledger persistence.
     * @param configService - Configuration client for the relay-deployment toggle.
     * @param schedulerRegistry - Scheduler used to register the cron job only when relay is enabled.
     */
    constructor(
        @Inject(TOKEN_INBOX_LEDGER_PORT) private readonly ledgerPort: IInboxLedgerPort,
        private readonly configService: ConfigService,
        private readonly schedulerRegistry: SchedulerRegistry,
    ) {}

    /**
     * Registers the daily prune cron only on instances where relay workers are enabled, so only
     * background-work instances run the daily delete. When the toggle is off the job is never
     * scheduled, so no wasted tick fires at midnight.
     */
    onModuleInit() {
        if (!this.configService.getOrThrow<boolean>(ENV.RELAY_ENABLED)) {
            return;
        }

        const job = CronJob.from({
            cronTime: CronExpression.EVERY_DAY_AT_MIDNIGHT,
            onTick: () => {
                void this.handlePrune();
            },
        });

        this.schedulerRegistry.addCronJob('inbox-ledger-prune', job);
        job.start();
    }

    /**
     * Removes dedup markers first processed before the retention cutoff.
     */
    private async handlePrune() {
        try {
            await this.ledgerPort.prune(new Date(Date.now() - INBOX_LEDGER_RETENTION_MS));
        } catch {
            // Pruning is best-effort housekeeping that self-heals on the next daily run. Swallow the
            // error so the scheduler does not log it: unbounded growth from repeated failures is caught
            // by table-size metrics, and no single missed prune is actionable.
        }
    }
}
