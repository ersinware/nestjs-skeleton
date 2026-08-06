/**
 * @file connection-log-message.enum.ts
 * @description Shared vocabulary of the connection outage-transition logs.
 */

/**
 * Fixed here once so outages read — and grep — identically across dependencies: exactly one LOST
 * and one RESTORED entry per episode.
 */
export enum ConnectionLogMessage {
    LOST = 'Connection lost.',
    RESTORED = 'Connection restored.',
}
