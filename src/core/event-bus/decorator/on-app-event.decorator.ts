/**
 * @file on-app-event.decorator.ts
 * @description Composed subscription decorator for in-process domain and integration events.
 */

import { OnEvent } from '@nestjs/event-emitter';

/**
 * Subscribes a listener method to an in-process domain or integration event with the project-wide
 * subscription policy applied.
 *
 * `suppressErrors: false` is load-bearing and the reason this wrapper exists: the library default is
 * `true`, which catches a thrown error and only logs it, letting `emitAsync` resolve — a failing
 * reaction (a Redis outage during eviction, a skipped revocation) would then fail silently. With it
 * set, the failure surfaces to the emitting caller. Centralizing the flag here means a new listener
 * cannot forget it and silently fall back to the swallowing default.
 *
 * @param event The event name to subscribe to, from the owning module's event enum
 * @returns The subscription method decorator
 */
export function OnAppEvent(event: string): MethodDecorator {
    return OnEvent(event, { suppressErrors: false });
}
