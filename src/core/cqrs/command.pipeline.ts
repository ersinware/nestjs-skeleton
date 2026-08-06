/**
 * @file command.pipeline.ts
 * @description Wraps the framework CommandBus in a behavior chain so cross-cutting write concerns
 * (cache invalidation today; transaction/outbox/metrics later) apply uniformly to every dispatched
 * command without a handler ever knowing they exist.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Command, ICommand } from '@nestjs/cqrs';
import { CommandBus } from '@nestjs/cqrs';

/**
 * Dependency injection token representing the ordered {@link ICommandBehavior} chain.
 */
export const TOKEN_COMMAND_BEHAVIORS = Symbol('TOKEN_COMMAND_BEHAVIORS');

/**
 * A single link in the command pipeline. Each behavior wraps the rest of the chain (`next`) and may
 * run logic before and/or after it — the classic middleware onion, ordered by the array binding.
 */
export interface ICommandBehavior {
    /**
     * Runs this behavior around the remainder of the pipeline.
     *
     * @param command The command being dispatched
     * @param next Invokes the next behavior, ending at the real bus dispatch
     * @returns The result returned by the command handler
     */
    execute<TResult>(command: ICommand, next: () => Promise<TResult>): Promise<TResult>;
}

/**
 * The single write entry point every edge (controller, facade, listener, cron) dispatches through
 * instead of the raw CommandBus, so a command cannot bypass the behavior chain. Non-participating
 * behaviors pass a command straight through, so routing every write here is free.
 */
@Injectable()
export class CommandPipeline {
    /**
     * @param commandBus The framework bus the chain ultimately delegates to
     * @param behaviors The ordered behaviors wrapping each dispatch
     */
    constructor(
        private readonly commandBus: CommandBus,
        @Inject(TOKEN_COMMAND_BEHAVIORS) private readonly behaviors: readonly ICommandBehavior[],
    ) {}

    /**
     * Dispatches a command through the behavior chain. Accepts only a typed `Command<R>`, so the
     * result type is always inferred from the command and never falls back to `unknown` — a command
     * that does not carry its result type on the `Command<R>` base is a compile error, by design.
     *
     * @param command The command to dispatch
     * @returns The result returned by the command handler
     */
    execute<R = void>(command: Command<R>): Promise<R> {
        const dispatch = (): Promise<R> => this.commandBus.execute<ICommand, R>(command);

        return this.behaviors.reduceRight<() => Promise<R>>(
            (next, behavior) => () => behavior.execute<R>(command, next),
            dispatch,
        )();
    }
}
