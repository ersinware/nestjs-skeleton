/**
 * @file user-join.enum.ts
 * @description Enumeration of allowed relational joins for the User entity to be used in normalized cache keys.
 */

export enum UserJoin {
    PROFILE = 'profile',
    POSTS = 'posts',
}
