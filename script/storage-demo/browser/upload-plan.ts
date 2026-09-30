/**
 * @file upload-plan.ts
 * @description Validates workflow-issued browser upload plans before any PUT.
 */

import type { BrowserUploadPlan, SignedUploadRequest, UploadOwner } from './upload-contract';
import { UploadError } from './upload-error';

/**
 * Rejects a plan that does not match the immutable selected file.
 *
 * @param plan Workflow-issued upload plan.
 * @param file File captured for this attempt.
 * @param owner Owning workflow with multipart completion when needed.
 */
export function validateUploadPlan(plan: BrowserUploadPlan, file: File, owner: UploadOwner): void {
    if (plan.mode === 'single') {
        validateSignedRequest(plan.request);
        return;
    }
    if (
        plan.mode !== 'multipart' ||
        !plan.uploadId ||
        !Number.isSafeInteger(plan.partSizeBytes) ||
        plan.partSizeBytes < 1 ||
        !Number.isSafeInteger(plan.partCount) ||
        plan.partCount < 1 ||
        plan.parts.length !== plan.partCount ||
        typeof owner.completeMultipart !== 'function'
    ) {
        throw new UploadError('Upload workflow returned an invalid multipart plan.');
    }
    for (const [index, part] of plan.parts.entries()) {
        if (part.partNumber !== index + 1) {
            throw new UploadError('Upload workflow returned an unordered multipart plan.');
        }
        validateSignedRequest(part.request);
    }
    if (Math.ceil(file.size / plan.partSizeBytes) !== plan.partCount) {
        throw new UploadError('Upload plan does not match the selected file size.');
    }
}

/**
 * Checks the request fields needed by a browser PUT.
 *
 * @param request Signed request.
 */
function validateSignedRequest(request: SignedUploadRequest): void {
    if (!request.url || !request.headers || !Number.isFinite(new Date(request.expiresAt).getTime())) {
        throw new UploadError('Upload workflow returned an invalid signed request.');
    }
}
