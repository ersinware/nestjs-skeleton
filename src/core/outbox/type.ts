export type ClaimedOutboxEvent = {
    id: string;
    type: string;
    aggregateId: string;
};
