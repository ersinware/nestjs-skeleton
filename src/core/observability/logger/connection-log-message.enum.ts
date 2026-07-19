/**
 * @file connection-log-message.enum.ts
 * @description Shared vocabulary of the per-outage connection transition logs. A dependency's
 * connection lifecycle is recorded as exactly one LOST and one RESTORED entry per episode, so the
 * two messages are fixed here once instead of drifting apart across the concerns that emit them.
 */

/**
 * Marks which side of a connection outage a transition log records, so an entry is identifiable as
 * the start or the end of an episode without inspecting its other fields.
 */
export enum ConnectionLogMessage {
    LOST = 'Connection lost.',
    RESTORED = 'Connection restored.',
}
