/**
 * @file storage.port.ts
 * @description Provider-independent object storage contract for account-owned upload flows.
 */

/**
 * Dependency injection token representing the {@link IStoragePort} contract.
 */
export const TOKEN_STORAGE_PORT = Symbol();

/**
 * Caller-selected cache metadata; storage applies no business default.
 */
export type StorageCachePolicy = {
    /**
     * Whether a response may be kept by shared caches.
     */
    readonly visibility: 'public' | 'private' | 'no-store';

    /**
     * Browser cache age in seconds.
     */
    readonly maxAgeSeconds?: number;

    /**
     * Shared cache age in seconds.
     */
    readonly sharedMaxAgeSeconds?: number;

    /**
     * Whether the bytes at this key are immutable.
     */
    readonly immutable?: boolean;
};

/**
 * Server-owned object descriptor for a new upload.
 */
export type StorageUploadRequest = {
    /**
     * Object key selected by the owning workflow.
     */
    readonly key: string;

    /**
     * Expected file size in bytes.
     */
    readonly sizeBytes: number;

    /**
     * Caller-approved media type.
     */
    readonly contentType: string;

    /**
     * Cache metadata for this object.
     */
    readonly cache: StorageCachePolicy;

    /**
     * Absolute expiry for the upload URLs issued by this request.
     */
    readonly deadline: Date;
};

/**
 * One presigned browser PUT request, including all headers that must be sent unchanged.
 */
export type StorageSignedRequest = {
    /**
     * Presigned URL including its signed host.
     */
    readonly url: string;

    /**
     * Required request headers.
     */
    readonly headers: Readonly<Record<string, string>>;

    /**
     * Actual signing expiry, no later than the upload deadline.
     */
    readonly expiresAt: Date;
};

/**
 * A numbered part URL in a multipart upload plan.
 */
export type StorageSignedPart = {
    /**
     * One-based S3 part number.
     */
    readonly partNumber: number;

    /**
     * Request to upload or retry this part.
     */
    readonly request: StorageSignedRequest;
};

/**
 * Signed plan for a single conditional PUT or every part of a multipart upload.
 */
export type StorageUploadPlan =
    | {
          /**
           * Single PUT upload mode.
           */
          readonly mode: 'single';

          /**
           * The only request needed to upload the object.
           */
          readonly request: StorageSignedRequest;
      }
    | {
          /**
           * Multipart upload mode.
           */
          readonly mode: 'multipart';

          /**
           * S3 upload identifier needed to complete or abort the upload.
           */
          readonly uploadId: string;

          /**
           * Planned size of each part except the last.
           */
          readonly partSizeBytes: number;

          /**
           * Exact number of parts in the plan.
           */
          readonly partCount: number;

          /**
           * One signed request for each part, in part-number order.
           */
          readonly parts: readonly StorageSignedPart[];
      };

/**
 * Metadata of an existing object.
 */
export type StorageObject = {
    /**
     * Actual object size in bytes.
     */
    readonly sizeBytes: number;

    /**
     * Provider ETag; not necessarily an MD5 digest.
     */
    readonly etag: string;

    /**
     * Stored media type, if present.
     */
    readonly contentType?: string;
};

/**
 * A client-observed part result; ETag is opaque and must be retained verbatim.
 */
export type StorageCompletedPart = {
    /**
     * One-based part number.
     */
    readonly partNumber: number;

    /**
     * Provider ETag from the successful upload response.
     */
    readonly etag: string;
};

/**
 * Data required to complete one authorized multipart upload.
 */
export type StorageCompleteMultipartRequest = {
    /**
     * Server-owned object key.
     */
    readonly key: string;

    /**
     * S3 upload identifier.
     */
    readonly uploadId: string;

    /**
     * Exact number of parts authorized by the upload plan.
     */
    readonly partCount: number;

    /**
     * Ordered manifest observed by the client.
     */
    readonly parts: readonly StorageCompletedPart[];
};

/**
 * Data required to abort one authorized multipart upload.
 */
export type StorageAbortMultipartRequest = {
    /**
     * Server-owned object key.
     */
    readonly key: string;

    /**
     * S3 upload identifier.
     */
    readonly uploadId: string;
};

/**
 * Object copy with an explicit content type and cache policy.
 */
export type StorageCopyRequest = {
    /**
     * Source object key.
     */
    readonly sourceKey: string;

    /**
     * Destination object key.
     */
    readonly destinationKey: string;

    /**
     * Source ETag precondition for safe retries.
     */
    readonly sourceEtag: string;

    /**
     * Preserved media type.
     */
    readonly contentType: string;

    /**
     * Destination cache policy.
     */
    readonly cache: StorageCachePolicy;
};

/**
 * S3 operations available only through workflow-owned application consumers.
 */
export interface IStoragePort {
    /**
     * Selects single PUT or multipart and signs every request needed to upload the object.
     *
     * @param request Server-owned object details and deadline.
     * @returns Upload mode and either one signed PUT or all numbered part requests.
     * @throws {InvalidInputException} When the object size exceeds S3 limits.
     * @throws {DependencyUnavailableException} When storage is unavailable.
     * @throws {SystemException} When storage configuration or authorization fails.
     */
    initiateUpload(request: StorageUploadRequest): Promise<StorageUploadPlan>;

    /**
     * Reads the current object metadata.
     *
     * @param key Server-owned object key.
     * @returns Object metadata.
     * @throws {ResourceNotFoundException} When the object is missing.
     * @throws {DependencyUnavailableException} When storage is unavailable.
     * @throws {SystemException} When storage authorization fails.
     */
    headObject(key: string): Promise<StorageObject>;

    /**
     * Completes a session conditionally using the client-observed manifest.
     *
     * @param request Authorized session identity, expected part count, and completed manifest.
     * @throws {InvalidInputException} When the manifest is invalid.
     * @throws {ResourceConflictException} When an object already occupies the key.
     * @throws {DependencyUnavailableException} When storage is unavailable.
     * @throws {SystemException} When storage authorization fails.
     */
    completeMultipart(request: StorageCompleteMultipartRequest): Promise<void>;

    /**
     * Aborts an unfinished multipart session without deleting a completed object.
     *
     * @param request Authorized session identity.
     * @throws {DependencyUnavailableException} When storage is unavailable.
     * @throws {SystemException} When storage authorization fails.
     */
    abortMultipart(request: StorageAbortMultipartRequest): Promise<void>;

    /**
     * Copies a small object without deleting its source; multipart copy is unsupported.
     *
     * @param request Source, target, content type, and cache policy.
     * @throws {InvalidInputException} When the source exceeds single-copy limits.
     * @throws {ResourceNotFoundException} When the source object is missing.
     * @throws {ResourceConflictException} When the source no longer matches.
     * @throws {DependencyUnavailableException} When storage is unavailable.
     * @throws {SystemException} When storage authorization fails.
     */
    copyObject(request: StorageCopyRequest): Promise<void>;

    /**
     * Deletes a source object idempotently; a missing key is already deleted.
     *
     * @param key Server-owned object key.
     * @throws {DependencyUnavailableException} When storage is unavailable.
     * @throws {SystemException} When storage authorization fails.
     */
    deleteObject(key: string): Promise<void>;
}
