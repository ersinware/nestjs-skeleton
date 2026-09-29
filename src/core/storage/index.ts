/**
 * @file index.ts
 * @description Public storage module and contracts.
 */

export { StorageModule } from 'src/core/storage/module';
export {
    TOKEN_STORAGE_PORT,
    type IStoragePort,
    type StorageAbortMultipartRequest,
    type StorageCachePolicy,
    type StorageCompleteMultipartRequest,
    type StorageCompletedPart,
    type StorageCopyRequest,
    type StorageObject,
    type StorageSignedPart,
    type StorageSignedRequest,
    type StorageUploadPlan,
    type StorageUploadRequest,
} from 'src/core/storage/port/storage.port';
export {
    MULTIPART_PART_SIZE_BYTES,
    MULTIPART_THRESHOLD_BYTES,
    planStorageUpload,
} from 'src/core/storage/storage-upload-policy';
