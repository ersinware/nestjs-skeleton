export type PendingOutboxEvent = {
    id: string;
    type: string;
    aggregateId: string;
};
