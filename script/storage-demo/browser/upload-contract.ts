/**
 * @file upload-contract.ts
 * @description Contracts shared by the browser upload workflow and transport.
 */

/**
 * A signed PUT request returned by the owning workflow.
 */
export type SignedUploadRequest = {
    /**
     * URL signed for this exact request.
     */
    readonly url: string;
    /**
     * Headers the browser must send with the PUT.
     */
    readonly headers: Readonly<Record<string, string>>;
    /**
     * Absolute URL expiration time.
     */
    readonly expiresAt: string | Date;
};

/**
 * A numbered multipart request.
 */
export type SignedUploadPart = {
    /**
     * One-based S3 part number.
     */
    readonly partNumber: number;
    /**
     * Signed request for the part.
     */
    readonly request: SignedUploadRequest;
};

/**
 * Browser-facing form of the storage upload plan.
 */
export type BrowserUploadPlan =
    | {
          /**
           * Upload mode.
           */
          readonly mode: 'single';
          /**
           * The whole-file PUT request.
           */
          readonly request: SignedUploadRequest;
      }
    | {
          /**
           * Upload mode.
           */
          readonly mode: 'multipart';
          /**
           * Server-owned multipart session identifier.
           */
          readonly uploadId: string;
          /**
           * Size of each part except the last.
           */
          readonly partSizeBytes: number;
          /**
           * Exact planned part count.
           */
          readonly partCount: number;
          /**
           * Signed requests in part-number order.
           */
          readonly parts: readonly SignedUploadPart[];
      };

/**
 * The ETag returned by a successful part PUT.
 */
export type CompletedUploadPart = {
    /**
     * One-based part number.
     */
    readonly partNumber: number;
    /**
     * Opaque ETag, retained verbatim.
     */
    readonly etag: string;
};

/**
 * Upload lifecycle, including owner-side completion.
 */
export type UploadState =
    | 'idle'
    | 'preparing'
    | 'uploading'
    | 'paused'
    | 'retrying'
    | 'reconciling'
    | 'completing'
    | 'uploaded'
    | 'cancelled'
    | 'failed'
    | 'expired';

/**
 * Progress counts confirmed bytes once; in-flight bytes are provisional.
 */
export type UploadProgress = {
    /**
     * Current lifecycle state.
     */
    readonly state: UploadState;
    /**
     * Bytes confirmed by successful PUT responses.
     */
    readonly completedBytes: number;
    /**
     * Confirmed bytes plus currently transferring bytes.
     */
    readonly transferredBytes: number;
    /**
     * File size.
     */
    readonly totalBytes: number;
};

/**
 * Owning workflow operations; no upload route or object key is chosen here.
 * Implementations classify network failures as ambiguous UploadError instances.
 */
export interface UploadOwner {
    /**
     * Authorizes this exact file and returns a fresh plan.
     *
     * @param file Selected file.
     * @param signal Cancellation signal.
     * @returns Authorized upload plan.
     */
    initiate(file: File, signal: AbortSignal): Promise<BrowserUploadPlan>;

    /**
     * Completes the authorized multipart session.
     *
     * @param plan Authorized multipart plan.
     * @param parts Confirmed ordered part manifest.
     * @param signal Cancellation signal.
     */
    completeMultipart?(
        plan: Extract<BrowserUploadPlan, { mode: 'multipart' }>,
        parts: readonly CompletedUploadPart[],
        signal: AbortSignal,
    ): Promise<void>;

    /**
     * Checks the final object through the workflow's server-side HEAD operation.
     * A true result must verify that this attempt's expected object exists.
     *
     * @param file Selected file.
     * @param plan Authorized plan.
     * @param signal Cancellation signal.
     * @returns Whether the final object is present and valid for this attempt.
     */
    reconcile(file: File, plan: BrowserUploadPlan, signal: AbortSignal): Promise<boolean>;

    /**
     * Finishes the owning workflow after its object is verified.
     * Must be idempotent because an HTTP response can be lost and retried.
     *
     * @param file Selected file.
     * @param plan Authorized plan.
     * @param signal Cancellation signal.
     */
    finalize(file: File, plan: BrowserUploadPlan, signal: AbortSignal): Promise<void>;

    /**
     * Rejects a plan when its form or selected file has changed.
     *
     * @param file Original selected file.
     * @returns Whether the owner still accepts this attempt.
     */
    isCurrent(file: File): boolean;
}

/**
 * Successful PUT result.
 */
export type PutResult = {
    /**
     * ETag needed for multipart completion, if exposed by S3 CORS.
     */
    readonly etag?: string;
};

/**
 * Browser transport with progress and explicit abort support.
 */
export interface UploadTransport {
    /**
     * Sends exactly one PUT attempt.
     *
     * @param request Signed request.
     * @param body Whole file or part slice.
     * @param signal Cancellation signal.
     * @param timeoutMs Timeout for this request.
     * @param onProgress Reports bytes sent by this attempt.
     * @returns Provider response details.
     */
    put(
        request: SignedUploadRequest,
        body: Blob,
        signal: AbortSignal,
        timeoutMs: number,
        onProgress: (bytes: number) => void,
    ): Promise<PutResult>;
}

/**
 * Scheduler limits for one upload instance.
 */
export type UploadClientOptions = {
    /**
     * Maximum simultaneous PUT requests.
     */
    readonly concurrency?: number;
    /**
     * Maximum attempts per request or owner operation.
     */
    readonly attempts?: number;
    /**
     * Timeout applied to each PUT request.
     */
    readonly requestTimeoutMs?: number;
    /**
     * Called when progress or lifecycle state changes.
     */
    readonly onProgress?: (progress: UploadProgress) => void;
};
