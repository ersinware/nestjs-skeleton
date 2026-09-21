/**
 * @file index.ts
 * @description Exports the public job-queue contracts and module.
 */

export {
    JOB_QUEUE_DEAD_LETTER,
    JOB_QUEUE_DEAD_LETTER_OPTIONS,
    JOB_QUEUE_DEAD_LETTER_REDRIVE,
    JOB_QUEUE_DEAD_LETTER_REDRIVE_OPTIONS,
} from 'src/core/job-queue/dead-letter-queue.constant';
export type { IJobConsumer, JobQueueOptions } from 'src/core/job-queue/job-consumer.interface';
export type { Job } from 'src/core/job-queue/job.type';
export { JobQueueModule } from 'src/core/job-queue/module';
export {
    TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT,
    type DeadLetterQueueStats,
    type DeadLetterRedriveQueueStats,
    type IJobQueueDeadLetterMetricsPort,
} from 'src/core/job-queue/port/job-queue-dead-letter-metrics.port';
export {
    TOKEN_JOB_QUEUE_DEAD_LETTER_OPERATOR_PORT,
    type IJobQueueDeadLetterOperatorPort,
} from 'src/core/job-queue/port/job-queue-dead-letter-operator.port';
export {
    TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT,
    type DeadLetterJob,
    type DeadLetterRedriveOperation,
    type IJobQueueDeadLetterReaderPort,
} from 'src/core/job-queue/port/job-queue-dead-letter-reader.port';
export { TOKEN_JOB_QUEUE_WRITER_PORT, type IJobQueueWriterPort } from 'src/core/job-queue/port/job-queue-writer.port';
