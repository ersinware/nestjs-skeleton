import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsPositive, Max, Min } from 'class-validator';
import { POSTGRES_MAX_INT } from 'src/database/constant';

@ApiSchema({ name: 'ParamId', description: 'Path parameter containing a unique numeric ID' })
export class ParamIdDto {
    @ApiProperty({
        type: 'integer',
        format: 'int32',
        minimum: 1,
        maximum: POSTGRES_MAX_INT,
        example: 1,
        description: 'The unique numeric ID of the resource',
    })
    @Type(() => Number)
    @IsNotEmpty({ message: 'ID cannot be empty.' })
    @IsInt({ message: 'ID must be an integer.' })
    @IsPositive({ message: 'ID must be a positive integer.' })
    @Min(1, { message: 'ID must be at least 1.' })
    @Max(POSTGRES_MAX_INT, { message: `ID cannot exceed the 32-bit integer limit (${POSTGRES_MAX_INT}).` })
    readonly id!: number;
}
