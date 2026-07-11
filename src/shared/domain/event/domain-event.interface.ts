/**
 * Contract for a domain event that can be persisted to the outbox.
 */
export interface IDomainEvent {
    readonly id: string;
    readonly type: string;
}
