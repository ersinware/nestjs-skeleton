export interface DatabaseError {
    code: string;
    detail?: string;
    column?: string;
    message?: string;
}

export interface WrappedError {
    cause?: DatabaseError;
}
