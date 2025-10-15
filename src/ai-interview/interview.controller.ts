import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InterviewService } from './interview.service';

@ApiBearerAuth('Authorization')
@ApiTags('interview')
@Controller('/api/v1/interview')
export class InterviewController {
  private readonly logger = new Logger(InterviewController.name);

  constructor(private readonly interviewService: InterviewService) {}

  /**
   * Upload interview recording video
   */
  @Post(':sessionId/upload-recording')
  @UseInterceptors(FileInterceptor('video'))
  async uploadRecording(
    @Param('sessionId') sessionId: string,
    @UploadedFile() video: Express.Multer.File,
  ) {
    if (!video) {
      throw new BadRequestException('No video file uploaded');
    }

    const allowedVideoTypes = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
    ];

    if (!allowedVideoTypes.includes(video.mimetype)) {
      throw new BadRequestException(
        'Only MP4, WebM, OGG, MOV, AVI, and MKV videos are allowed',
      );
    }

    const maxSizeInBytes = 500 * 1024 * 1024;
    if (video.size > maxSizeInBytes) {
      throw new BadRequestException('Video size cannot exceed 500MB');
    }

    return await this.interviewService.uploadInterviewRecording(
      sessionId,
      video,
    );
  }

  /**
   * Get interview video signed URL
   */
  @Get(':sessionId/video')
  async getInterviewVideo(@Param('sessionId') sessionId: string) {
    return await this.interviewService.getInterviewVideo(sessionId);
  }

  @Get(':sessionId/feedback')
  async getInterviewFeedback(@Param('sessionId') sessionId: string) {
    return await this.interviewService.generateInterviewFeedback(sessionId);
  }

  @Get('user/:userId/completed')
  async getCompletedInterviews(@Param('userId') userId: string) {
    return await this.interviewService.getCompletedInterviews(userId);
  }
}

