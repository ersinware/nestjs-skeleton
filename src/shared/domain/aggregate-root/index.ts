/**
 * @file index.ts
 * @description Exports the public aggregate-root abstractions.
 */

export { AggregateRoot } from 'src/shared/domain/aggregate-root/aggregate-root';
export { AggregateRootNew } from 'src/shared/domain/aggregate-root/aggregate-root-new';
export {
    PrincipalAggregateRoot,
    type PermissionChange,
} from 'src/shared/domain/aggregate-root/principal-aggregate-root';
export { PrincipalAggregateRootNew } from 'src/shared/domain/aggregate-root/principal-aggregate-root-new';
export { SoftDeletableAggregateRoot } from 'src/shared/domain/aggregate-root/soft-deletable-aggregate-root';
export { SoftDeletableAggregateRootNew } from 'src/shared/domain/aggregate-root/soft-deletable-aggregate-root-new';
