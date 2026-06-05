import { BadRequestException } from '@nestjs/common';
import { describe, it, expect } from 'vitest';
import { NotEmptyBodyPipe } from './not-empty-body.pipe';

describe('NotEmptyBodyPipe', () => {
    const pipe = new NotEmptyBodyPipe();

    it('should be defined', () => {
        expect(pipe).toBeDefined();
    });

    describe('falsy values', () => {
        it('should throw BadRequestException when value is null', () => {
            expect(() => pipe.transform(null)).toThrow(BadRequestException);
        });

        it('should throw BadRequestException when value is undefined', () => {
            expect(() => pipe.transform(undefined)).toThrow(BadRequestException);
        });

        it('should throw BadRequestException when value is an empty string', () => {
            expect(() => pipe.transform('')).toThrow(BadRequestException);
        });
    });

    describe('non-object types', () => {
        it('should throw BadRequestException when value is a string', () => {
            expect(() => pipe.transform('hello')).toThrow(BadRequestException);
        });

        it('should throw BadRequestException when value is a number', () => {
            expect(() => pipe.transform(123)).toThrow(BadRequestException);
        });

        it('should throw BadRequestException when value is a boolean', () => {
            expect(() => pipe.transform(true)).toThrow(BadRequestException);
        });
    });

    describe('arrays', () => {
        it('should throw BadRequestException when value is an empty array', () => {
            expect(() => pipe.transform([])).toThrow(BadRequestException);
        });

        it('should throw BadRequestException when value is a non-empty array', () => {
            expect(() => pipe.transform([1, 2, 3])).toThrow(BadRequestException);
        });
    });

    describe('empty objects', () => {
        it('should throw BadRequestException when value is an empty object', () => {
            expect(() => pipe.transform({})).toThrow(BadRequestException);
        });
    });

    describe('valid non-empty values', () => {
        it('should return the value as-is when value is a non-empty object', () => {
            expect(pipe.transform({ id: 1 })).toEqual({ id: 1 });
        });
    });
});
