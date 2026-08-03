/**
 * @file index.ts
 * @description Public entry point of the exception concern. Nothing outside may import past this barrel.
 */

export { ErrorDefaultDto } from 'src/core/exception/dto/error-default.dto';
export { GlobalExceptionFilter } from 'src/core/exception/filter/global-exception.filter';
