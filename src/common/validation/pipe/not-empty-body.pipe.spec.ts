/**
 * @file not-empty-body.pipe.spec.ts
 * @description Unit tests for the not-empty-body validation pipe.
 */

import { BadRequestException, ArgumentMetadata } from '@nestjs/common';
import { describe, it, expect } from 'vitest';
import { NotEmptyBodyPipe } from './not-empty-body.pipe';

describe('NotEmptyBodyPipe', () => {
    const pipe = new NotEmptyBodyPipe(),
        bodyMetadata: ArgumentMetadata = { type: 'body' },
        queryMetadata: ArgumentMetadata = { type: 'query' };

    it('should be defined', () => {
        expect(pipe).toBeDefined();
    });

    describe('when metadata type is not body', () => {
        it('should return null as-is', () => {
            expect(pipe.transform(null, queryMetadata)).toBeNull();
        });

        it('should return undefined as-is', () => {
            expect(pipe.transform(undefined, queryMetadata)).toBeUndefined();
        });

        it('should return empty object as-is', () => {
            expect(pipe.transform({}, queryMetadata)).toEqual({});
        });
    });

    describe('when metadata type is body', () => {
        describe('falsy values', () => {
            it('should throw BadRequestException when value is null', () => {
                expect(() => pipe.transform(null, bodyMetadata)).toThrow(BadRequestException);
            });

            it('should throw BadRequestException when value is undefined', () => {
                expect(() => pipe.transform(undefined, bodyMetadata)).toThrow(BadRequestException);
            });

            it('should throw BadRequestException when value is an empty string', () => {
                expect(() => pipe.transform('', bodyMetadata)).toThrow(BadRequestException);
            });
        });

        describe('non-object types', () => {
            it('should throw BadRequestException when value is a string', () => {
                expect(() => pipe.transform('hello', bodyMetadata)).toThrow(BadRequestException);
            });

            it('should throw BadRequestException when value is a number', () => {
                expect(() => pipe.transform(123, bodyMetadata)).toThrow(BadRequestException);
            });

            it('should throw BadRequestException when value is a boolean', () => {
                expect(() => pipe.transform(true, bodyMetadata)).toThrow(BadRequestException);
            });
        });

        describe('arrays', () => {
            it('should throw BadRequestException when value is an empty array', () => {
                expect(() => pipe.transform([], bodyMetadata)).toThrow(BadRequestException);
            });

            it('should throw BadRequestException when value is a non-empty array', () => {
                expect(() => pipe.transform([1, 2, 3], bodyMetadata)).toThrow(BadRequestException);
            });
        });

        describe('empty objects', () => {
            it('should throw BadRequestException when value is an empty object', () => {
                expect(() => pipe.transform({}, bodyMetadata)).toThrow(BadRequestException);
            });
        });

        describe('valid non-empty values', () => {
            it('should return the value as-is when value is a non-empty object', () => {
                expect(pipe.transform({ id: 1 }, bodyMetadata)).toEqual({ id: 1 });
            });
        });
    });
});
