/**
 * @file storage-upload-policy.spec.ts
 * @description Boundary tests for deterministic S3 upload geometry.
 */

import {
    MULTIPART_PART_SIZE_BYTES,
    MULTIPART_THRESHOLD_BYTES,
    planStorageUpload,
} from 'src/core/storage/storage-upload-policy';
import { InvalidInputException } from 'src/shared/exception';
import { describe, expect, it } from 'vitest';

describe('planStorageUpload', () => {
    it.each([0, MULTIPART_THRESHOLD_BYTES - 1, MULTIPART_THRESHOLD_BYTES])(
        'uses one PUT through the 7 MiB boundary (%i bytes)',
        (sizeBytes) => {
            expect(planStorageUpload(sizeBytes)).toEqual({ mode: 'single', sizeBytes });
        },
    );

    it('uses multipart above the boundary and permits a small final part', () => {
        expect(planStorageUpload(MULTIPART_THRESHOLD_BYTES + 1)).toEqual({
            mode: 'multipart',
            sizeBytes: MULTIPART_THRESHOLD_BYTES + 1,
            partSizeBytes: MULTIPART_PART_SIZE_BYTES,
            partCount: 2,
        });
    });

    it('keeps all non-final parts at the configured size', () => {
        expect(planStorageUpload(3 * MULTIPART_PART_SIZE_BYTES + 1)).toEqual({
            mode: 'multipart',
            sizeBytes: 3 * MULTIPART_PART_SIZE_BYTES + 1,
            partSizeBytes: MULTIPART_PART_SIZE_BYTES,
            partCount: 4,
        });
    });

    it('increases part size to stay within 10,000 parts and accepts the technical maximum', () => {
        const exactLimit = MULTIPART_PART_SIZE_BYTES * 10_000;
        expect(planStorageUpload(exactLimit)).toEqual({
            mode: 'multipart',
            sizeBytes: exactLimit,
            partSizeBytes: MULTIPART_PART_SIZE_BYTES,
            partCount: 10_000,
        });

        const sizeBytes = exactLimit + 1;
        const plan = planStorageUpload(sizeBytes);

        expect(plan).toEqual({ mode: 'multipart', sizeBytes, partSizeBytes: 5_242_881, partCount: 10_000 });
        expect(planStorageUpload(10_000 * 5 * 1024 * 1024 * 1024)).toEqual({
            mode: 'multipart',
            sizeBytes: 10_000 * 5 * 1024 * 1024 * 1024,
            partSizeBytes: 5 * 1024 * 1024 * 1024,
            partCount: 10_000,
        });
    });

    it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
        'rejects invalid or unsupported file sizes (%s)',
        (sizeBytes) => {
            expect(() => planStorageUpload(sizeBytes)).toThrow(InvalidInputException);
        },
    );
});
