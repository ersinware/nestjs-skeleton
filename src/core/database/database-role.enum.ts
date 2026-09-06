/**
 * @file database-role.enum.ts
 * @description The role of a PostgreSQL connection in a primary/replica topology.
 */

/**
 * Names a connection in the outage-transition logs, so a replica episode is never read as a
 * primary one.
 */
export enum DatabaseRole {
    PRIMARY = 'primary',
    REPLICA = 'replica',
}
