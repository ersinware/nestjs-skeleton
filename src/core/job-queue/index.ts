/**
 * @file index.ts
 * @description Exports the public job-queue contracts and module.
 */

export type { IJobConsumer } from 'src/core/job-queue/job-consumer.interface';
export type { Job } from 'src/core/job-queue/job.type';
export { JobQueueModule } from 'src/core/job-queue/module';
export { TOKEN_JOB_QUEUE_WRITER_PORT, type IJobQueueWriterPort } from 'src/core/job-queue/port/job-queue-writer.port';
