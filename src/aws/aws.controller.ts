import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { AwsService } from './awsClient.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as crypto from 'crypto';
import { SkipThrottle } from '@nestjs/throttler';


@ApiBearerAuth('Authorization')
@ApiTags('aws')
@Controller('/api/v1/aws')
export class AwsController {
  constructor(
    private readonly awsClientService: AwsService,
  ) { }

  @Post('upload-file')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    
    // Log file details
    Logger.log('uploadFile', {
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });

    // Generate file extension from original filename or mimetype
    const fileExtension = this.getFileExtension(file.originalname, file.mimetype);
    const s3Key = `${crypto.randomUUID()}${fileExtension}`;
    
    Logger.log('s3Key', s3Key);
    
    return await this.awsClientService.uploadFile(
      s3Key,
      file.buffer,
      file.mimetype,
    );
  }

  @Post('upload-document')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate file size (10MB limit)
    const maxSizeInBytes = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSizeInBytes) {
      throw new BadRequestException('File size cannot exceed 10MB');
    }

    // Validate document types
    const allowedDocTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];

    if (!allowedDocTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only PDF, DOC, DOCX, and TXT files are allowed');
    }

    const fileExtension = this.getFileExtension(file.originalname, file.mimetype);
    const s3Key = `documents/${crypto.randomUUID()}${fileExtension}`;
    
    Logger.log('Document upload', { filename: file.originalname, s3Key, size: file.size });
    
    return await this.awsClientService.uploadFile(
      s3Key,
      file.buffer,
      file.mimetype,
    );
  }

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate image types
    const allowedImageTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp'
    ];

    if (!allowedImageTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, GIF, and WebP images are allowed');
    }

    const fileExtension = this.getFileExtension(file.originalname, file.mimetype);
    const s3Key = `images/${crypto.randomUUID()}${fileExtension}`;
    
    Logger.log('Image upload', { filename: file.originalname, s3Key });
    
    return await this.awsClientService.uploadFile(
      s3Key,
      file.buffer,
      file.mimetype,
    );
  }

  private getFileExtension(filename: string, mimetype: string): string {
    // Try to get extension from filename first
    if (filename && filename.includes('.')) {
      const extension = filename.substring(filename.lastIndexOf('.'));
      return extension;
    }
    
    // Fallback to mimetype mapping
    const mimetypeMap: { [key: string]: string } = {
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'text/plain': '.txt',
    };
    
    return mimetypeMap[mimetype] || '';
  }

  @SkipThrottle()

  @Get('signedUrl/:key')
  async getSignedUrl(@Param('key') key: string) {
    Logger.log('getSignedUrl', key);
    const signedUrl =
      await this.awsClientService.generateShortLivedSignedUrl(key);
    return signedUrl;
  }
  @Get('get-signed-url-with-content-type/:key')
  @SkipThrottle()
  async getSignedUrlWithType(@Param('key') key: string) {
    const { signedUrl, contentType } =
      await this.awsClientService.generateShortLivedSignedUrlWithContentType(key);
    return { signedUrl, contentType };
  }



  @Delete('deleteFile/:key')
  async deleteFile(@Param('key') key: string) {
    const s3Key = `${key}`;
    return await this.awsClientService.deleteFile(s3Key);
  }


  @SkipThrottle()
  @Get('get-asset/:key')
  async testCdnUrl(@Param('key') key: string) {
    Logger.log('testCdnUrl', key);

    // 1. Generate signed URL directly
    const signedUrl =
      await this.awsClientService.generateShortLivedSignedUrl(key);
    return {
      signedUrl,
    };
  }
}
