/**
 * @file command.ts
 * @description Command to request an asynchronous redrive of the shared dead-letter queue.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Starts one exclusive operation to redrive all currently eligible dead-letter jobs.
 */
export class StartDeadLetterRedriveCommand extends Command<string> {}
