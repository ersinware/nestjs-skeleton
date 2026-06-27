/**
 * @file index.ts
 * @description Barrel file that aggregates and re-exports all database schema definitions and relations.
 */

export * from './base.schema';

export * from './user/user.schema';
export * from './admin/admin.schema';
