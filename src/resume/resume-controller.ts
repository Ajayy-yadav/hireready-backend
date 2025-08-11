import { Controller, Post, UseInterceptors, UploadedFile, Body, Get, Query, Res, HttpStatus, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

import type { Multer } from 'multer';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UploadBase64Dto } from './dto/upload-base64.dto';
import { UserService } from '../user/user.service';
import { SupabaseStorageService } from 'src/supabase/supabase-storage-service';

@Controller('resume')
export class ResumeController {
constructor(
    private readonly storageService: SupabaseStorageService,
    private readonly userService: UserService
) {}

@Post('upload-resume')
@ApiOperation({ summary: 'Upload file to Supabase Storage' })
@ApiConsumes('multipart/form-data')
@ApiBody({
    schema: {
        type: 'object',
        properties: {
            file: {
                type: 'string',
                format: 'binary',
            },
            userId: {
                type: 'string',
            },
        },
        required: ['file', 'userId'],
    },
})
@UseInterceptors(FileInterceptor('file'))
async uploadResume(
    @UploadedFile() file: Multer.File,
    @Body('userId') userId: string
) {
    if (!file) {
        throw new BadRequestException('File is required');
    }

    if (!userId) {
        throw new BadRequestException('User ID is required');
    }

    // Validate file type (allow only PDF and DOC/DOCX)
    const allowedMimeTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    
    if (!allowedMimeTypes.includes(file.mimetype)) {
        throw new BadRequestException('Only PDF and DOC/DOCX files are allowed');
    }
    
    try {
        const bucket = 'resumes';
        const path = `${userId}/${Date.now()}_${file.originalname}`;
        await this.storageService.uploadFile(bucket, path, file.buffer, file.mimetype);
        const publicUrl = this.storageService.getPublicUrl(bucket, path);
        await this.userService.updateResumeUrl(userId, publicUrl);
        return { url: publicUrl, filename: file.originalname, mimetype: file.mimetype };
    } catch (error) {
        throw new BadRequestException('Upload failed: ' + error.message);
    }
}

  @Post('upload-image')
@ApiOperation({ summary: 'Upload image to Supabase Storage' })
@ApiConsumes('multipart/form-data')
@ApiBody({
    schema: {
        type: 'object',
        properties: {
            file: {
                type: 'string',
                format: 'binary',
            },
            userId: {
                type: 'string',
            },
        },
        required: ['file', 'userId'],
    },
})
@UseInterceptors(FileInterceptor('file'))
async uploadImage(
  @UploadedFile() file: Multer.File,
  @Body('userId') userId: string
) {
  if (!file) {
    throw new BadRequestException('File is required');
  }

  if (!userId) {
    throw new BadRequestException('User ID is required');
  }

  // Validate file type (allow only JPG, PNG, SVG)
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/svg+xml'];
  
  if (!allowedMimeTypes.includes(file.mimetype)) {
    throw new BadRequestException('Only JPG, PNG, and SVG images are allowed');
  }
  
  try {
    const bucket = 'images';
    const path = `${userId}/${Date.now()}_${file.originalname}`;
    await this.storageService.uploadFile(bucket, path, file.buffer, file.mimetype);
    const publicUrl = this.storageService.getPublicUrl(bucket, path);
    await this.userService.updateImageUrl(userId, publicUrl);
    return { url: publicUrl, filename: file.originalname, mimetype: file.mimetype };
  } catch (error) {
    throw new BadRequestException('Upload failed: ' + error.message);
  }
}

  @Get('fetch')
    @ApiOperation({ summary: 'Get Public URL from Supabase Storage' })
  async fetchResume(
    @Query('userId') userId: string,
    @Query('filename') filename: string,
    @Res() res: Response
  ) {
    const bucket = 'resumes';
    const path = `${userId}/${filename}`;
    const fileStream = await this.storageService.downloadFile(bucket, path);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fileStream.pipe(res);
  }

  @Post('upload-resume-base64')
  @ApiOperation({ summary: 'Upload resume as base64 to Supabase Storage' })
  async uploadResumeBase64(@Body() uploadDto: UploadBase64Dto) {
    // Check if fileBase64 exists in the request body
    if (!uploadDto || !uploadDto.fileBase64) {
      throw new BadRequestException('Missing required field: fileBase64');
    }
    
    // Extract base64 data - remove the prefix if it exists (data:application/pdf;base64,)
    let base64Data = uploadDto.fileBase64;
    if (base64Data.includes(',')) {
      base64Data = base64Data.split(',')[1];
    }
    
    // Validate file type (allow only PDF and DOC/DOCX)
    const allowedMimeTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    
    if (!allowedMimeTypes.includes(uploadDto.mimetype)) {
      throw new BadRequestException('Only PDF and DOC/DOCX files are allowed');
    }
    
    try {
      // Convert base64 to buffer
      let fileBuffer;
      try {
        fileBuffer = Buffer.from(base64Data, 'base64');
      } catch (e) {
        throw new BadRequestException('Invalid base64 data format');
      }
      
      const bucket = 'resumes';
      const path = `${uploadDto.userId}/${Date.now()}_${uploadDto.filename}`;
      await this.storageService.uploadFile(bucket, path, fileBuffer, uploadDto.mimetype);
      const publicUrl = this.storageService.getPublicUrl(bucket, path);
      await this.userService.updateResumeUrl(uploadDto.userId, publicUrl);
      
      return {
        url: publicUrl,
        filename: uploadDto.filename,
        mimetype: uploadDto.mimetype
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Upload failed: ' + error.message);
    }
  }

  @Post('upload-image-base64')
  @ApiOperation({ summary: 'Upload image as base64 to Supabase Storage' })
  async uploadImageBase64(@Body() uploadDto: UploadBase64Dto) {
    // Check if fileBase64 exists in the request body
    if (!uploadDto || !uploadDto.fileBase64) {
      throw new BadRequestException('Missing required field: fileBase64');
    }
    
    // Extract base64 data - remove the prefix if it exists (data:image/jpeg;base64,)
    let base64Data = uploadDto.fileBase64;
    if (base64Data.includes(',')) {
      base64Data = base64Data.split(',')[1];
    }
    
    // Validate file type (allow only JPG, PNG, SVG)
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/svg+xml'];
    
    if (!allowedMimeTypes.includes(uploadDto.mimetype)) {
      throw new BadRequestException('Only JPG, PNG, and SVG images are allowed');
    }
    
    try {
      // Convert base64 to buffer
      let fileBuffer;
      try {
        fileBuffer = Buffer.from(base64Data, 'base64');
      } catch (e) {
        throw new BadRequestException('Invalid base64 data format');
      }
      
      const bucket = 'images';
      const path = `${uploadDto.userId}/${Date.now()}_${uploadDto.filename}`;
      await this.storageService.uploadFile(bucket, path, fileBuffer, uploadDto.mimetype);
      const publicUrl = this.storageService.getPublicUrl(bucket, path);
      await this.userService.updateImageUrl(uploadDto.userId, publicUrl);
      
      return {
        url: publicUrl,
        filename: uploadDto.filename,
        mimetype: uploadDto.mimetype
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Upload failed: ' + error.message);
    }
  }
}