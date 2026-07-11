/**
 * @file user-cache.listener.ts
 * @description Event listener responsible for invalidating user caches when domain events occur.
 */

import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ICachePort } from 'src/core/cache';
import { TOKEN_CACHE_PORT } from 'src/core/cache';
import { CacheKeys } from 'src/module/user/application/util';
import {
    UserEvent,
    type UserBannedEvent,
    type UserDeletedEvent,
    type UserPasswordChangedEvent,
    type UserUnbannedEvent,
    type UserUpdatedEvent,
} from 'src/module/user/domain/event';

/**
 * Listener to keep the cache synchronized with database mutations by reacting to user events.
 */
@Injectable()
export class UserCacheListener {
    /**
     * Injects the required cache service.
     *
     * @param cachePort The cache service abstraction.
     */
    constructor(@Inject(TOKEN_CACHE_PORT) private readonly cachePort: ICachePort) {}

    /**
     * Handles user modification and deletion events.
     * Invalidates the specific user cache.
     *
     * @param event The update, password-change, delete, or status-change event payload containing the user ID.
     */
    @OnEvent(UserEvent.UPDATED)
    @OnEvent(UserEvent.PASSWORD_CHANGED)
    @OnEvent(UserEvent.BANNED)
    @OnEvent(UserEvent.UNBANNED)
    @OnEvent(UserEvent.DELETED)
    async handleUserModified(
        event: UserUpdatedEvent | UserPasswordChangedEvent | UserBannedEvent | UserUnbannedEvent | UserDeletedEvent,
    ) {
        await this.cachePort.delete(CacheKeys.userById(event.id));
    }
}
