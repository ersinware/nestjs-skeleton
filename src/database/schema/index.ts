/**
 * @file index.ts
 * @description Barrel file that aggregates and re-exports all database schema definitions and relations.
 */

export * from './base.schema';

export * from './users/users.schema';
export * from './admins/admins.schema';
