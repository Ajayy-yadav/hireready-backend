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

    // Validate video types
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

    // Validate file size (500MB limit for videos)
    const maxSizeInBytes = 500 * 1024 * 1024; // 500MB
    if (video.size > maxSizeInBytes) {
      throw new BadRequestException('Video size cannot exceed 500MB');
    }

    this.logger.log(
      `Uploading video for session ${sessionId}: ${video.originalname} (${video.size} bytes)`,
    );

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
    this.logger.log(`Getting video for session: ${sessionId}`);
    return await this.interviewService.getInterviewVideo(sessionId);
  }

  /**
   * Get AI-generated feedback based on interview history
   */
  @Get(':sessionId/feedback')
  async getInterviewFeedback(@Param('sessionId') sessionId: string) {
    this.logger.log(`Generating feedback for session: ${sessionId}`);
    return await this.interviewService.generateInterviewFeedback(sessionId);
  }

  /**
   * Get all completed interviews for a user
   */
  @Get('user/:userId/completed')
  async getCompletedInterviews(@Param('userId') userId: string) {
    this.logger.log(`Fetching completed interviews for user: ${userId}`);
    return await this.interviewService.getCompletedInterviews(userId);
  }
}

