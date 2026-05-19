import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class NotEmptyBodyPipe implements PipeTransform {
    transform(value: unknown): unknown {
        if (!value || typeof value !== 'object' || Object.keys(value).length === 0) {
            throw new BadRequestException('Request body cannot be empty.');
        }

        return value;
    }
}
