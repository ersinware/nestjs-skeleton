/**
 * @file sort-order.enum.ts
 * @description Generic sort direction shared by paginated list endpoints — the `asc` / `desc` ordering
 * applied to a chosen sort column. Kept transport-neutral so any listing (outbox, email, …) reuses one
 * direction vocabulary rather than redefining it per module.
 */

/**
 * The direction a list query is ordered in.
 */
export enum SortOrder {
    ASC = 'asc',
    DESC = 'desc',
}
