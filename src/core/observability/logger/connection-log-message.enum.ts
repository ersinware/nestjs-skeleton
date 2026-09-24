/**
 * @file connection-log-message.enum.ts
 * @description Shared vocabulary of the connection outage-transition logs.
 */

/**
 * Fixed here once so outages read — and grep — identically across dependencies: exactly one LOST
 * and one RESTORED entry per episode.
 */
export enum ConnectionLogMessage {
    /**
     * The outage began — logged as `warn` with the driver error, once per episode.
     */
    LOST = 'Connection lost.',

    /**
     * The outage ended — logged as `info`, once per episode.
     */
    RESTORED = 'Connection restored.',
}
