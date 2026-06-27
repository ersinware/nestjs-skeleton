/**
 * @file user-cache.listener.ts
 * @description Event listener responsible for invalidating user caches when domain events occur.
 */

import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TOKEN_CACHE_SERVICE } from 'src/common/port/cache/cache.constant';
import type { ICacheService } from 'src/common/port/cache/cache-service.interface';
import { CacheKeys } from 'src/common/port/cache/util/cache-key.util';
import { UserEvent } from '../enum/user-event.enum';
import type { UserDeletedEvent } from '../event/user-deleted.event';
import type { UserUpdatedEvent } from '../event/user-updated.event';
import type { UserStatusChangedEvent } from '../event/user-status-changed.event';

/**
 * Listener to keep the cache synchronized with database mutations by reacting to user events.
 */
@Injectable()
export class UserCacheListener {
    /**
     * Injects the required cache service.
     *
     * @param cacheService The cache service abstraction.
     */
    constructor(@Inject(TOKEN_CACHE_SERVICE) private readonly cacheService: ICacheService) {}

    /**
     * Handles the user creation event.
     * Invalidates the paginated list cache.
     */
    @OnEvent(UserEvent.CREATED)
    async handleUserCreated() {
        await this.cacheService.deletePattern(CacheKeys.userListPattern());
    }

    /**
     * Handles user modification and deletion events.
     * Invalidates the specific user cache and the paginated list cache.
     *
     * @param event The update or delete event payload containing the user ID.
     */
    @OnEvent(UserEvent.UPDATED)
    @OnEvent(UserEvent.DELETED)
    @OnEvent(UserEvent.STATUS_CHANGED)
    async handleUserModified(event: UserUpdatedEvent | UserDeletedEvent | UserStatusChangedEvent) {
        await Promise.all([
            this.cacheService.deletePattern(CacheKeys.userByIdPattern(event.userId)),
            this.cacheService.deletePattern(CacheKeys.userListPattern()),
        ]);
    }
}
