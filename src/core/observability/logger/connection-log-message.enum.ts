/**
 * @file connection-log-message.enum.ts
 * @description Shared vocabulary of the connection outage-transition logs, fixed here once so
 * outages read — and grep — identically across dependencies.
 */

/**
 * Marks which side of a connection outage a transition log records: exactly one LOST and one
 * RESTORED entry per episode.
 */
export enum ConnectionLogMessage {
    LOST = 'Connection lost.',
    RESTORED = 'Connection restored.',
}
