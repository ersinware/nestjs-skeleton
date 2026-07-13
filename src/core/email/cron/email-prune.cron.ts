/**
 * @file email-prune.cron.ts
 * @description Cron that prunes `SENT` email rows past their retention window, keeping the ledger
 * bounded while preserving a recent audit trail.
 */

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ENV } from 'src/core/config';
import { EMAIL_SENT_RETENTION_MS } from 'src/core/email/constant';
import { TOKEN_EMAIL_LEDGER_PORT, type IEmailLedgerPort } from 'src/core/email/port/email-ledger.port';

/**
 * Scheduled cleanup for the email ledger. Removes successfully sent rows once they age out of the
 * retention window.
 */
@Injectable()
export class EmailPruneCron implements OnModuleInit {
    /**
     * Creates an instance of EmailPruneCron.
     *
     * @param emailLedgerPort - Email ledger persistence.
     * @param configService - Configuration client for the relay-deployment toggle.
     * @param schedulerRegistry - Scheduler used to register the cron job only when relay is enabled.
     */
    constructor(
        @Inject(TOKEN_EMAIL_LEDGER_PORT) private readonly emailLedgerPort: IEmailLedgerPort,
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

        this.schedulerRegistry.addCronJob('email-prune', job);
        job.start();
    }

    /**
     * Removes `SENT` rows last updated before the retention cutoff.
     */
    private async handlePrune() {
        try {
            await this.emailLedgerPort.pruneSent(new Date(Date.now() - EMAIL_SENT_RETENTION_MS));
        } catch {
            // Pruning is best-effort housekeeping that self-heals on the next daily run. Swallow the
            // error so the scheduler does not log it: unbounded growth from repeated failures is caught
            // by table-size metrics, and no single missed prune is actionable.
        }
    }
}
