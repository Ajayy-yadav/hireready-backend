import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  Param,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiResponse, ApiBody } from '@nestjs/swagger';
import { ResumeAnalysisService } from './resume-analysis.service';
import { ResumeAnalysisRequestDto, ResumeAnalysisResponseDto } from './dto/resume-analysis.dto';

@ApiTags('Resume Analysis')
@Controller('resume-analysis')
export class ResumeAnalysisController {
  constructor(private readonly resumeAnalysisService: ResumeAnalysisService) {}

  @Post('analyze/:userId')
  @UseInterceptors(FileInterceptor('resume'))
  @ApiOperation({
    summary: 'Analyze resume against job description',
    description: 'Upload a resume (PDF/DOC/DOCX) and job description to get compatibility score, missing skills, and motivational feedback'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Resume file and job description',
    type: 'multipart/form-data',
    schema: {
      type: 'object',
      properties: {
        resume: {
          type: 'string',
          format: 'binary',
          description: 'Resume file (PDF, DOC, or DOCX)',
        },
        jobDescription: {
          type: 'string',
          description: 'Job description text',
          example: 'We are looking for a Senior Software Engineer with 5+ years of experience in Node.js, React, TypeScript, AWS, Docker, and Kubernetes.'
        },
      },
      required: ['resume', 'jobDescription'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Resume analysis completed successfully',
    type: ResumeAnalysisResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid file format or missing data',
  })
  async analyzeResume(
    @Param('userId') userId: string,
    @UploadedFile() resume: Express.Multer.File,
    @Body() jobDescriptionDto: ResumeAnalysisRequestDto,
  ): Promise<ResumeAnalysisResponseDto> {
    if (!resume) {
      throw new BadRequestException('Resume file is required');
    }

    // Validate file type
    const allowedMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];

    if (!allowedMimeTypes.includes(resume.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Please upload PDF, DOC, or DOCX files only.'
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (resume.size > maxSize) {
      throw new BadRequestException('File size too large. Maximum size is 10MB.');
    }

    try {
      // Parse resume content
      const resumeContent = await this.resumeAnalysisService.parseResumeContent(
        resume.buffer,
        resume.mimetype
      );

      if (!resumeContent || resumeContent.trim().length === 0) {
        throw new BadRequestException('Could not extract text from the uploaded file');
      }

      // Analyze resume against job description
      const analysisResult = await this.resumeAnalysisService.analyzeResume(
        resumeContent,
        jobDescriptionDto.jobDescription,
        userId  // Pass userId to save in user table
      );

      return analysisResult;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Analysis failed: ${error.message}`);
    }
  }
}
