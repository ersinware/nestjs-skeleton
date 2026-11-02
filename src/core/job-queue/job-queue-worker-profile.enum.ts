/**
 * @file job-queue-worker-profile.enum.ts
 * @description Defines canonical queue worker latency and polling-pressure profiles.
 */

/**
 * Selects the canonical polling cadence for a queue workload.
 */
export enum JobQueueWorkerProfile {
    /**
     * Security-critical and latency-sensitive work.
     */
    CRITICAL = 'critical',

    /**
     * Interactive or prompt eventual-reconciliation work.
     */
    HIGH = 'high',

    /**
     * Interactive work that tolerates moderate retry discovery latency.
     */
    MEDIUM = 'medium',

    /**
     * Deferred notification and maintenance work.
     */
    LOW = 'low',
}
