/**
 * @file index.ts
 * @description Exports the public aggregate-root abstractions.
 */

export { AggregateRoot } from 'src/shared/domain/aggregate-root/aggregate-root';
export {
    PrincipalAggregateRoot,
    type PermissionChange,
} from 'src/shared/domain/aggregate-root/principal-aggregate-root';
export { SoftDeletableAggregateRoot } from 'src/shared/domain/aggregate-root/soft-deletable-aggregate-root';
