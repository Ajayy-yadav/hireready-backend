import { PartialType } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
    @IsOptional()
    @IsString()
    resumeKey?: string;  // Store S3 key for resume
    
    @IsOptional()
    @IsString()
    imageKey?: string;   // Store S3 key for profile image
}
