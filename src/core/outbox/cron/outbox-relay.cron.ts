/**
 * @file outbox-relay.cron.ts
 * @description Fallback cron that periodically triggers an outbox relay drain. It covers any missed
 * LISTEN/NOTIFY signals and re-claims events whose processing lease has expired.
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ENV } from 'src/core/config';
import { OutboxRelayService } from 'src/core/outbox/relay/outbox-relay.service';

/**
 * Scheduled safety net for the outbox relay. Because claiming uses `FOR UPDATE SKIP LOCKED`, running
 * this on every instance is safe — no event is dispatched twice.
 */
@Injectable()
export class OutboxRelayCron implements OnModuleInit {
    /**
     * Creates an instance of OutboxRelayCron.
     *
     * @param outboxRelayService - Shared relay engine that performs the actual draining.
     * @param configService - Configuration client for the relay-deployment toggle.
     * @param schedulerRegistry - Scheduler used to register the cron job only when relay is enabled.
     */
    constructor(
        private readonly outboxRelayService: OutboxRelayService,
        private readonly configService: ConfigService,
        private readonly schedulerRegistry: SchedulerRegistry,
    ) {}

    /**
     * Registers the fallback drain cron only on instances where relay workers are enabled. When the
     * toggle is off the job is never scheduled, so no wasted tick fires every interval.
     */
    onModuleInit() {
        if (!this.configService.getOrThrow<boolean>(ENV.RELAY_ENABLED)) {
            return;
        }

        const job = CronJob.from({
            cronTime: CronExpression.EVERY_5_MINUTES,
            onTick: () => {
                void this.outboxRelayService.requestDrain();
            },
        });

        this.schedulerRegistry.addCronJob('outbox-relay', job);
        job.start();
    }
}
