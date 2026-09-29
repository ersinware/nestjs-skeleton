/**
 * @file storage-upload-policy.ts
 * @description Selects an S3 upload mode and bounded part geometry from a trusted byte count.
 */

import { InvalidInputException } from 'src/shared/exception';

/**
 * Uploads at or below this size use one conditional PUT.
 */
export const MULTIPART_THRESHOLD_BYTES = 7 * 1024 * 1024;

/**
 * Default size of each multipart part, except the last.
 */
export const MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * S3 maximum number of parts in one multipart upload.
 */
export const MAX_PARTS = 10_000;

/**
 * S3 maximum size of one multipart part (5 GiB).
 */
const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Largest object representable by the part size and count limits.
 */
const MAX_OBJECT_BYTES = MAX_PART_BYTES * MAX_PARTS;

/**
 * Chooses a stable upload shape without allocating one entry per part.
 *
 * @param sizeBytes Exact file size supplied by the caller.
 * @returns Single PUT or a multipart geometry bounded by S3 limits.
 * @throws {InvalidInputException} When the file size cannot be represented by S3.
 */
export function planStorageUpload(sizeBytes: number):
    | { readonly mode: 'single' }
    | {
          readonly mode: 'multipart';
          readonly partSizeBytes: number;
          readonly partCount: number;
      } {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_OBJECT_BYTES) {
        throw new InvalidInputException('File size exceeds the supported storage limits.');
    }

    if (sizeBytes <= MULTIPART_THRESHOLD_BYTES) {
        return { mode: 'single' };
    }

    const partSizeBytes = Math.max(MULTIPART_PART_SIZE_BYTES, Math.ceil(sizeBytes / MAX_PARTS));

    return { mode: 'multipart', partSizeBytes, partCount: Math.ceil(sizeBytes / partSizeBytes) };
}
