/**
 * @file aggregate-root.ts
 * @description Defines an aggregate root that accumulates durable jobs.
 */

import type { JobDefinition } from 'src/shared/domain/job';

/**
 * Base for aggregates that raise durable jobs with their state changes.
 */
export abstract class AggregateRoot {
    /**
     * Aggregate identity.
     */
    readonly id: string;

    /**
     * The persisted version this in-memory state was loaded at. Writers own its advancement.
     */
    readonly version: number;

    /**
     * Jobs raised since the last pull.
     */
    private readonly jobs: JobDefinition[] = [];

    /**
     * Initializes the aggregate identity and persistence version.
     *
     * @param id The unique identifier
     * @param version The persisted version the state was loaded at; 0 for a new aggregate
     */
    protected constructor(id: string, version: number) {
        this.id = id;
        this.version = version;
    }

    /**
     * Adds durable jobs raised by an aggregate mutation.
     *
     * @param jobs The jobs to enqueue with the aggregate write
     */
    protected addJob(jobs: readonly JobDefinition[]) {
        this.jobs.push(...jobs);
    }

    /**
     * Returns and clears jobs raised since the previous pull.
     *
     * @returns The jobs accumulated since the last pull
     */
    pullJobs(): readonly JobDefinition[] {
        const jobs = [...this.jobs];
        this.jobs.length = 0;

        return jobs;
    }
}
