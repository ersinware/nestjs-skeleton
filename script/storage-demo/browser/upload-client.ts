/**
 * @file upload-client.ts
 * @description Coordinates one workflow-owned file upload and its completion.
 */

import type {
    BrowserUploadPlan,
    CompletedUploadPart,
    PutResult,
    SignedUploadRequest,
    UploadClientOptions,
    UploadOwner,
    UploadProgress,
    UploadState,
    UploadTransport,
} from './upload-contract';
import { UploadError } from './upload-error';
import { validateUploadPlan } from './upload-plan';
import { callUploadOwner, isAmbiguousUploadError, isRetryableUploadError, waitForUploadRetry } from './upload-retry';
import { XhrUploadTransport } from './xhr-upload.transport';

/**
 * One immutable file attempt with its own scheduler and progress accounting.
 */
export class UploadClient {
    private state: UploadState = 'idle';
    private completedBytes = 0;
    private readonly activeBytes = new Map<number, number>();
    private readonly activeRequests = new Set<AbortController>();
    private readonly runController = new AbortController();
    private resumeWaiter: (() => void) | undefined;
    private pauseGeneration = 0;
    private readonly concurrency: number;
    private readonly attempts: number;
    private readonly requestTimeoutMs: number;

    /**
     * Captures the selected File and owning workflow for a single run.
     *
     * @param file Selected file; a changed selection needs a new instance.
     * @param owner Workflow callbacks.
     * @param transport Browser PUT transport.
     * @param options Scheduler bounds and progress callback.
     */
    constructor(
        private readonly file: File,
        private readonly owner: UploadOwner,
        private readonly transport: UploadTransport = new XhrUploadTransport(),
        private readonly options: UploadClientOptions = {},
    ) {
        this.concurrency = options.concurrency ?? 3;
        this.attempts = options.attempts ?? 4;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
        if (
            !Number.isInteger(this.concurrency) ||
            this.concurrency < 1 ||
            !Number.isInteger(this.attempts) ||
            this.attempts < 1 ||
            !Number.isFinite(this.requestTimeoutMs) ||
            this.requestTimeoutMs <= 0
        ) {
            throw new UploadError('Upload scheduler settings are invalid.');
        }
    }

    /**
     * Current snapshot; transfer completion can precede workflow completion.
     */
    get progress(): UploadProgress {
        return {
            state: this.state,
            completedBytes: this.completedBytes,
            transferredBytes: Math.min(
                this.file.size,
                this.completedBytes + [...this.activeBytes.values()].reduce((sum, bytes) => sum + bytes, 0),
            ),
            totalBytes: this.file.size,
        };
    }

    /**
     * Starts this file's only authorization and upload attempt.
     */
    async start() {
        if (this.state !== 'idle') {
            throw new UploadError('This upload attempt has already started.');
        }
        this.setState('preparing');
        try {
            this.assertCurrent();
            const plan = await callUploadOwner(
                (signal) => this.owner.initiate(this.file, signal),
                this.runController.signal,
                this.requestTimeoutMs,
                () => this.assertCurrent(),
            );
            this.assertCurrent();
            validateUploadPlan(plan, this.file, this.owner);
            this.setState('uploading');
            if (plan.mode === 'single') {
                await this.uploadSingle(plan);
            } else {
                await this.uploadMultipart(plan);
            }
            await this.waitIfPaused();
            this.assertCurrent();
            this.setState('completing');
            await this.retryOwnerOperation((signal) => this.owner.finalize(this.file, plan, signal), plan, false);
            this.setState('uploaded');
        } catch (error) {
            const cancelled = this.runController.signal.aborted;
            this.runController.abort();
            if (!cancelled) {
                this.setState(error instanceof UploadError && error.code === 'Expired' ? 'expired' : 'failed');
            }
            throw error;
        }
    }

    /**
     * Stops current PUTs while retaining successful parts for resume.
     */
    pause() {
        if (this.state === 'uploading' || this.state === 'retrying') {
            this.pauseGeneration++;
            this.setState('paused');
            for (const controller of this.activeRequests) {
                controller.abort();
            }
        }
    }

    /**
     * Allows scheduling to continue after a pause.
     */
    resume() {
        if (this.state === 'paused') {
            this.setState('uploading');
            this.resumeWaiter?.();
            this.resumeWaiter = undefined;
        }
    }

    /**
     * Permanently cancels this instance.
     */
    cancel() {
        if (
            this.state === 'uploaded' ||
            this.state === 'failed' ||
            this.state === 'expired' ||
            this.state === 'cancelled'
        ) {
            return;
        }
        this.setState('cancelled');
        this.runController.abort();
        for (const controller of this.activeRequests) {
            controller.abort();
        }
        this.resumeWaiter?.();
    }

    /**
     * Emits an updated lifecycle snapshot.
     *
     * @param state New state.
     */
    private setState(state: UploadState) {
        this.state = state;
        this.options.onProgress?.(this.progress);
    }

    /**
     * Stops stale or cancelled file attempts.
     */
    private assertCurrent() {
        if (this.runController.signal.aborted) {
            throw new DOMException('Upload cancelled.', 'AbortError');
        }
        if (!this.owner.isCurrent(this.file)) {
            throw new UploadError('The form or selected file changed; start a new upload.');
        }
    }

    /**
     * Sends one PUT and verifies uncertain results through the owner.
     *
     * @param plan Authorized single request.
     */
    private async uploadSingle(plan: Extract<BrowserUploadPlan, { mode: 'single' }>) {
        try {
            await this.uploadPart(1, plan.request, this.file);
        } catch (error) {
            if (!isAmbiguousUploadError(error)) {
                throw error;
            }
            if (!(await this.reconcile(plan))) {
                throw error;
            }
            this.completedBytes = this.file.size;
            this.setState('uploading');
        }
    }

    /**
     * Runs bounded part workers, then completes their ordered manifest.
     *
     * @param plan Authorized multipart requests.
     */
    private async uploadMultipart(plan: Extract<BrowserUploadPlan, { mode: 'multipart' }>) {
        const completed = new Map<number, CompletedUploadPart>();
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < plan.parts.length) {
                const index = next++;
                const part = plan.parts[index];
                if (!part) {
                    throw new UploadError('Multipart plan changed while uploading.');
                }
                const offset = index * plan.partSizeBytes;
                const body = this.file.slice(offset, Math.min(offset + plan.partSizeBytes, this.file.size));
                const result = await this.uploadPart(part.partNumber, part.request, body);
                if (!result.etag) {
                    throw new UploadError('S3 did not expose the part ETag; check bucket CORS configuration.');
                }
                completed.set(part.partNumber, { partNumber: part.partNumber, etag: result.etag });
            }
        };
        const workers = Array.from({ length: Math.min(this.concurrency, plan.partCount) }, () => worker());
        try {
            await Promise.all(workers);
        } catch (error) {
            for (const controller of this.activeRequests) {
                controller.abort();
            }
            await Promise.allSettled(workers);
            if (isAmbiguousUploadError(error) && (await this.reconcile(plan))) {
                this.completedBytes = this.file.size;
                this.options.onProgress?.(this.progress);
                return;
            }
            throw error;
        }
        await this.waitIfPaused();
        this.assertCurrent();
        this.setState('completing');
        const manifest = [...completed.values()].sort((a, b) => a.partNumber - b.partNumber);
        await this.retryOwnerOperation((signal) => this.owner.completeMultipart!(plan, manifest, signal), plan);
    }

    /**
     * Retries one PUT without occupying a request slot during backoff.
     *
     * @param partNumber Part number used for progress tracking.
     * @param request Signed PUT request.
     * @param body Exact bytes for this request.
     * @returns PUT response details.
     */
    private async uploadPart(partNumber: number, request: SignedUploadRequest, body: Blob): Promise<PutResult> {
        for (let attempt = 1; attempt <= this.attempts; attempt++) {
            await this.waitIfPaused();
            this.assertCurrent();
            if (Date.now() >= new Date(request.expiresAt).getTime()) {
                throw new UploadError('Signed upload URL expired; start a new upload.', undefined, 'Expired');
            }
            const controller = new AbortController();
            const abort = (): void => controller.abort();
            this.runController.signal.addEventListener('abort', abort, { once: true });
            this.activeRequests.add(controller);
            const pauseGeneration = this.pauseGeneration;
            let failure: unknown;
            try {
                const result = await this.transport.put(
                    request,
                    body,
                    controller.signal,
                    this.requestTimeoutMs,
                    (bytes) => {
                        this.activeBytes.set(partNumber, Math.min(body.size, bytes));
                        this.options.onProgress?.(this.progress);
                    },
                );
                this.activeBytes.delete(partNumber);
                this.completedBytes += body.size;
                this.options.onProgress?.(this.progress);
                return result;
            } catch (error) {
                failure = error;
            } finally {
                this.activeBytes.delete(partNumber);
                this.activeRequests.delete(controller);
                this.runController.signal.removeEventListener('abort', abort);
            }
            if (this.pauseGeneration !== pauseGeneration) {
                attempt--;
                continue;
            }
            this.assertCurrent();
            if (!isRetryableUploadError(failure) || attempt === this.attempts) {
                throw failure;
            }
            this.setState('retrying');
            await waitForUploadRetry(attempt, this.runController.signal);
            await this.waitIfPaused();
            this.setState('uploading');
        }
        throw new UploadError('Upload attempt budget exhausted.');
    }

    /**
     * Retries a workflow step; only object completion may use HEAD to prove success.
     *
     * @param operation Owner callback.
     * @param plan Authorized upload plan.
     * @param reconcileCompletion Whether a final object proves this step succeeded.
     */
    private async retryOwnerOperation(
        operation: (signal: AbortSignal) => Promise<void>,
        plan: BrowserUploadPlan,
        reconcileCompletion = true,
    ) {
        for (let attempt = 1; attempt <= this.attempts; attempt++) {
            this.assertCurrent();
            try {
                await callUploadOwner(operation, this.runController.signal, this.requestTimeoutMs, () =>
                    this.assertCurrent(),
                );
                return;
            } catch (error) {
                this.assertCurrent();
                if (reconcileCompletion && isAmbiguousUploadError(error) && (await this.reconcile(plan))) {
                    return;
                }
                if (!isRetryableUploadError(error) || attempt === this.attempts) {
                    throw error;
                }
                this.setState('retrying');
                await waitForUploadRetry(attempt, this.runController.signal);
                await this.waitIfPaused();
                this.setState('completing');
            }
        }
    }

    /**
     * Asks the owner to verify the final object after an uncertain response.
     *
     * @param plan Authorized plan.
     * @returns Whether the final object exists for this attempt.
     */
    private async reconcile(plan: BrowserUploadPlan): Promise<boolean> {
        this.setState('reconciling');
        this.assertCurrent();
        const exists = await callUploadOwner(
            (signal) => this.owner.reconcile(this.file, plan, signal),
            this.runController.signal,
            this.requestTimeoutMs,
            () => this.assertCurrent(),
        );
        this.assertCurrent();
        return exists;
    }

    /**
     * Suspends scheduling without holding a request slot.
     */
    private async waitIfPaused(): Promise<void> {
        while (this.state === 'paused') {
            await new Promise<void>((resolve) => {
                this.resumeWaiter = resolve;
            });
        }
        this.assertCurrent();
    }
}
