import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
    resumeKey?: string;  // Store S3 key for resume
    imageKey?: string;   // Store S3 key for profile image
}
