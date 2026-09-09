/**
 * @file cache-invalidation.behavior.ts
 * @description Command pipeline behavior that evicts the cache keys a successful mutation dirtied,
 * best-effort in the same request for commands that opt in.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { ICommand } from '@nestjs/cqrs';
import type { ICachePort } from 'src/core/cache';
import { TOKEN_CACHE_PORT } from 'src/core/cache';
import type { ICommandBehavior } from 'src/core/cqrs/command.pipeline';

/**
 * A command that dirties one or more cache keys. Eviction is coarser than event-driven invalidation
 * — it fires whenever the command succeeds, even if the handler no-op'd — but same-module, immediate,
 * and independent of event delivery. Redis outages and concurrent fills can leave stale entries.
 * Cross-module cache reactions still belong on domain events.
 */
export interface ICacheInvalidatingCommand {
    /**
     * The cache keys this command's mutation invalidates.
     *
     * @returns The keys to evict after the command succeeds
     */
    invalidatedKeys(): readonly string[];
}

/**
 * Narrows a dispatched command to one that declares invalidated cache keys.
 *
 * @param command The command under inspection
 * @returns True when the command implements the invalidating contract
 */
function isCacheInvalidatingCommand(command: ICommand): command is ICommand & ICacheInvalidatingCommand {
    return typeof (command as Partial<ICacheInvalidatingCommand>).invalidatedKeys === 'function';
}

/**
 * Evicts a command's declared keys after it succeeds. Eviction runs only once the handler resolves,
 * so a failed command (e.g. not-found) leaves the cache untouched. Non-invalidating commands pass
 * straight through.
 */
@Injectable()
export class CacheInvalidationBehavior implements ICommandBehavior {
    /**
     * @param cachePort The cache the behavior evicts through
     */
    constructor(@Inject(TOKEN_CACHE_PORT) private readonly cachePort: ICachePort) {}

    /**
     * Runs the command, then evicts its declared keys on success.
     *
     * @param command The dispatched command
     * @param next Invokes the remainder of the pipeline (ultimately the handler)
     * @returns The result returned by the command handler
     */
    async execute<TResult>(command: ICommand, next: () => Promise<TResult>): Promise<TResult> {
        const result = await next();

        if (isCacheInvalidatingCommand(command)) {
            await Promise.all(command.invalidatedKeys().map((key) => this.cachePort.delete(key)));
        }

        return result;
    }
}
