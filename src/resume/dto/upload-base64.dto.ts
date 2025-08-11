import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsNotEmpty, IsString } from 'class-validator';

export class UploadBase64Dto {
  @ApiProperty({
    description: 'Base64 encoded file content',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/4QD...'
  })
  @IsNotEmpty()
  @IsBase64()
  fileBase64: string;

  @ApiProperty({
    description: 'Original filename',
    example: 'profile.jpg'
  })
  @IsNotEmpty()
  @IsString()
  filename: string;

  @ApiProperty({
    description: 'File mime type',
    example: 'image/jpeg'
  })
  @IsNotEmpty()
  @IsString()
  mimetype: string;

  @ApiProperty({
    description: 'User ID',
    example: 'user123'
  })
  @IsNotEmpty()
  @IsString()
  userId: string;
}
