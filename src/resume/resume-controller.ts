import { Controller, Post, UseInterceptors, UploadedFile, Body, Get, Query, Res, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

import type { Multer } from 'multer';
import { ApiBody, ApiConsumes, ApiOperation } from '@nestjs/swagger';
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
    const bucket = 'resumes';
    const path = `${userId}/${Date.now()}_${file.originalname}`;
    await this.storageService.uploadFile(bucket, path, file.buffer, file.mimetype);
    const publicUrl = this.storageService.getPublicUrl(bucket, path);
    await this.userService.updateResumeUrl(userId, publicUrl);
    return { url: publicUrl, filename: file.originalname, mimetype: file.mimetype };
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
  const bucket = 'images';
  const path = `${userId}/${Date.now()}_${file.originalname}`;
  await this.storageService.uploadFile(bucket, path, file.buffer, file.mimetype);
  const publicUrl = this.storageService.getPublicUrl(bucket, path);
   await this.userService.updateImageUrl(userId, publicUrl);
  return { url: publicUrl, filename: file.originalname, mimetype: file.mimetype };
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
}