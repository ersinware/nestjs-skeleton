/**
 * @file outbox-prune.cron.ts
 * @description Cron that prunes `PUBLISHED` outbox rows past their retention window, keeping the
 * ledger bounded while preserving a recent audit trail.
 */

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ENV } from 'src/core/config';
import { OUTBOX_PUBLISHED_RETENTION_MS } from 'src/core/outbox/constant';
import { TOKEN_OUTBOX_LEDGER_PORT, type IOutboxLedgerPort } from 'src/core/outbox/port/outbox-ledger.port';

/**
 * Scheduled cleanup for the outbox ledger. Removes successfully published rows once they age out of
 * the retention window.
 */
@Injectable()
export class OutboxPruneCron implements OnModuleInit {
    /**
     * Creates an instance of OutboxPruneCron.
     *
     * @param outboxLedgerPort - Outbox ledger persistence.
     * @param configService - Configuration client for the relay-deployment toggle.
     * @param schedulerRegistry - Scheduler used to register the cron job only when relay is enabled.
     */
    constructor(
        @Inject(TOKEN_OUTBOX_LEDGER_PORT) private readonly outboxLedgerPort: IOutboxLedgerPort,
        private readonly configService: ConfigService,
        private readonly schedulerRegistry: SchedulerRegistry,
    ) {}

    /**
     * Registers the daily prune cron only on instances where relay workers are enabled. When the
     * toggle is off the job is never scheduled, so no wasted tick fires at midnight.
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

        this.schedulerRegistry.addCronJob('outbox-prune', job);
        job.start();
    }

    /**
     * Removes `PUBLISHED` rows last updated before the retention cutoff.
     */
    private async handlePrune() {
        try {
            await this.outboxLedgerPort.prunePublished(new Date(Date.now() - OUTBOX_PUBLISHED_RETENTION_MS));
        } catch {
            // Pruning is best-effort housekeeping that self-heals on the next daily run. Swallow the
            // error so the scheduler does not log it: unbounded growth from repeated failures is caught
            // by table-size metrics, and no single missed prune is actionable.
        }
    }
}
