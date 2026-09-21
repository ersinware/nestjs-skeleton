/**
 * @file command.ts
 * @description Command to drain redrivable jobs from the shared dead-letter queue.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Redrives eligible dead-letter jobs through pg-boss in bounded internal batches.
 */
export class RedriveDeadLetterJobsCommand extends Command<void> {}
