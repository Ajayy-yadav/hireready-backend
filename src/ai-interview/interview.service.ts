import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SttService } from '../stt/stt.service';
import { TtsService } from '../tts/tts.service';
import { LlmService } from '../llm/llm.service';
import { AwsService } from '../aws/awsClient.service';
import { StartInterviewDto } from './dto/start-interview.dto';
import { ConversationHistory } from './dto/interview-message.dto';
import * as crypto from 'crypto';

@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);

  constructor(
    private prisma: PrismaService,
    private sttService: SttService,
    private ttsService: TtsService,
    private llmService: LlmService,
    private awsService: AwsService,
  ) {}

  /**
   * Start a new interview session (OPTIMIZED - Generate all questions at once!)
   */
  async startInterview(dto: StartInterviewDto) {
    try {
      const totalQuestions = dto.totalQuestions || 5;
      
      // Generate ALL questions at once (single LLM call!)
      const allQuestions = await this.llmService.generateAllQuestions(
        dto.jobDescription,
        totalQuestions,
      );

      // Create session with pre-generated questions
      const session = await this.prisma.interviewSession.create({
        data: {
          userId: dto.userId,
          jobDescription: dto.jobDescription,
          totalQuestions,
          currentQuestion: 1,
          status: 'in_progress',
          history: [{ role: 'assistant', content: allQuestions[0] }], // Initialize with first question
          metadata: {
            questions: allQuestions,
          },
        },
      });

      return {
        sessionId: session.id,
        question: allQuestions[0],
        currentQuestion: 1,
        totalQuestions,
      };
    } catch (error) {
      this.logger.error(`Error starting interview: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Process transcript (OPTIMIZED - No LLM call, just fetch pre-generated question!)
   */
  async processTranscript(sessionId: string, userAnswer: string) {
    try {
      // Fetch session and update in one operation
      const session = await this.prisma.interviewSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new Error('Interview session not found');
      }

      const nextQuestionNum = session.currentQuestion + 1;
      const isComplete = nextQuestionNum > session.totalQuestions;

      // Prepare history update
      const history = (session.history as any[]) || [];
      history.push({ role: 'user', content: userAnswer });

      if (isComplete) {
        // Complete interview - single DB update
        await this.prisma.interviewSession.update({
          where: { id: sessionId },
          data: {
            currentQuestion: nextQuestionNum,
            status: 'completed',
            completedAt: new Date(),
            history,
          },
        });
        
        return {
          transcript: userAnswer,
          question: null,
          questionAudio: null,
          currentQuestion: nextQuestionNum,
          totalQuestions: session.totalQuestions,
          isComplete: true,
        };
      }

      // Get pre-generated next question
      const metadata = session.metadata as any;
      const preGeneratedQuestions = metadata?.questions || [];
      const nextQuestionIndex = nextQuestionNum - 1;
      const nextQuestion = preGeneratedQuestions[nextQuestionIndex];

      if (!nextQuestion) {
        this.logger.error('No pre-generated question found, falling back to LLM');
        const generatedQuestion = await this.generateNextQuestion(sessionId);
        const questionAudio = await this.ttsService.textToSpeech(generatedQuestion);
        
        return {
          transcript: userAnswer,
          question: generatedQuestion,
          questionAudio,
          currentQuestion: nextQuestionNum,
          totalQuestions: session.totalQuestions,
          isComplete: false,
        };
      }

      // Add next question to history
      history.push({ role: 'assistant', content: nextQuestion });

      // Optimize: Start TTS generation and DB update in parallel
      const [questionAudio] = await Promise.all([
        this.ttsService.textToSpeech(nextQuestion),
        this.prisma.interviewSession.update({
          where: { id: sessionId },
          data: { currentQuestion: nextQuestionNum, history },
        }),
      ]);

      return {
        transcript: userAnswer,
        question: nextQuestion,
        questionAudio,
        currentQuestion: nextQuestionNum,
        totalQuestions: session.totalQuestions,
        isComplete: false,
      };
    } catch (error) {
      this.logger.error(`Error in processTranscript: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Process audio input from user (STT -> LLM -> TTS)
   * @deprecated Use processTranscript with live STT for better performance
   */
  async processAudioInput(sessionId: string, audioBuffer: Buffer) {
    try {
      const transcriptionResult = await this.sttService.transcribeFromFile(audioBuffer);
      const userAnswer = this.sttService.extractTranscript(transcriptionResult);

      if (!userAnswer || userAnswer.trim().length === 0) {
        this.logger.error('STT returned empty transcript');
        throw new Error('No speech detected in audio');
      }

      return await this.processTranscript(sessionId, userAnswer);
    } catch (error) {
      this.logger.error(`Error in processAudioInput: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate next question using LLM
   */
  async generateNextQuestion(sessionId: string): Promise<string> {
    try {
      const session = await this.prisma.interviewSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new Error('Interview session not found');
      }

      const history = (session.history as any[]) || [];
      const question = await this.llmService.llmResponse(
        session.jobDescription,
        history as ConversationHistory[],
      );

      return question;
    } catch (error) {
      this.logger.error(`Error generating question: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Add message to conversation history
   */
  async addToHistory(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
  ) {
    try {
      const session = await this.prisma.interviewSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new Error('Interview session not found');
      }

      const history = (session.history as any[]) || [];
      history.push({ role, content });

      await this.prisma.interviewSession.update({
        where: { id: sessionId },
        data: { history },
      });
    } catch (error) {
      this.logger.error(`Error adding to history: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get interview conversation history
   */
  async getConversationHistory(sessionId: string): Promise<ConversationHistory[]> {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error('Interview session not found');
    }

    return (session.history as any[]) || [];
  }

  /**
   * Upload interview recording video to S3
   */
  async uploadInterviewRecording(
    sessionId: string,
    video: Express.Multer.File,
  ) {
    try {
      const session = await this.prisma.interviewSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new NotFoundException('Interview session not found');
      }

      const fileExtension = this.getFileExtension(
        video.originalname,
        video.mimetype,
      );
      const s3Key = `interview-recordings/${sessionId}/${crypto.randomUUID()}${fileExtension}`;

      // Upload to S3 and update DB in parallel
      const [uploadResult] = await Promise.all([
        this.awsService.uploadFile(s3Key, video.buffer, video.mimetype),
        this.prisma.interviewSession.update({
          where: { id: sessionId },
          data: { videoRecordingKey: s3Key },
        }),
      ]);

      return {
        sessionId,
        videoKey: uploadResult.key,
        message: 'Video uploaded successfully',
      };
    } catch (error) {
      this.logger.error(
        `Error uploading interview recording: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get interview video signed URL
   */
  async getInterviewVideo(sessionId: string) {
    try {
      const session = await this.prisma.interviewSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new NotFoundException('Interview session not found');
      }

      if (!session.videoRecordingKey) {
        throw new NotFoundException('No video recording found for this interview');
      }

      // Generate signed URL (valid for 1 hour)
      const signedUrl = await this.awsService.generateShortLivedSignedUrl(
        session.videoRecordingKey,
        3600,
      );

      return {
        sessionId,
        videoUrl: signedUrl,
        expiresIn: 3600,
      };
    } catch (error) {
      this.logger.error(
        `Error getting interview video: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Generate AI feedback based on interview history
   */
  async generateInterviewFeedback(sessionId: string) {
    try {
      const session = await this.prisma.interviewSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new NotFoundException('Interview session not found');
      }

      // Return cached feedback if available
      if (session.feedback && typeof session.feedback === 'object') {
        return {
          sessionId,
          feedback: session.feedback,
          totalQuestions: session.totalQuestions,
          completedQuestions: Math.floor((session.history as any[]).length / 2),
          status: session.status,
          cached: true,
        };
      }

      const history = (session.history as any[]) || [];

      if (history.length === 0) {
        throw new Error('No interview history available for feedback');
      }

      const feedback = await this.llmService.generateInterviewFeedback(
        session.jobDescription,
        history,
      );

      const scoreOutOf100 = Math.round((feedback.overallScore / 10) * 100);
      
      // Update session and user in parallel
      if (!session.feedbackCounted) {
        await Promise.all([
          this.prisma.interviewSession.update({
            where: { id: sessionId },
            data: { 
              feedback,
              feedbackCounted: true,
            },
          }),
          this.prisma.user.update({
            where: { id: session.userId },
            data: {
              latestInterviewScore: scoreOutOf100,
              totalInterviews: { increment: 1 },
              lastInterviewCompletedAt: new Date(),
            },
          }),
        ]);
      } else {
        await Promise.all([
          this.prisma.interviewSession.update({
            where: { id: sessionId },
            data: { 
              feedback,
              feedbackCounted: true,
            },
          }),
          this.prisma.user.update({
            where: { id: session.userId },
            data: {
              latestInterviewScore: scoreOutOf100,
              lastInterviewCompletedAt: new Date(),
            },
          }),
        ]);
      }

      return {
        sessionId,
        feedback,
        totalQuestions: session.totalQuestions,
        completedQuestions: Math.floor(history.length / 2), 
        status: session.status,
        cached: false,
      };
    } catch (error) {
      this.logger.error(
        `Error generating feedback: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get all completed interviews for a user
   */
  async getCompletedInterviews(userId: string) {
    try {
      const completedInterviews = await this.prisma.interviewSession.findMany({
        where: {
          userId,
          status: 'completed',
        },
        orderBy: {
          completedAt: 'desc',
        },
        select: {
          id: true,
          jobDescription: true,
          status: true,
          totalQuestions: true,
          currentQuestion: true,
          videoRecordingKey: true,
          history: true,
          feedback: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        userId,
        totalInterviews: completedInterviews.length,
        interviews: completedInterviews.map((interview) => ({
          sessionId: interview.id,
          jobDescription: interview.jobDescription,
          totalQuestions: interview.totalQuestions,
          answeredQuestions: interview.currentQuestion - 1,
          history: interview.history,
          feedback: interview.feedback,
          hasFeedback: !!interview.feedback,
          recordingKey: interview.videoRecordingKey,
          hasVideoRecording: !!interview.videoRecordingKey,
          startedAt: interview.startedAt,
          completedAt: interview.completedAt,
          duration: interview.completedAt && interview.startedAt
            ? Math.floor((interview.completedAt.getTime() - interview.startedAt.getTime()) / 1000 / 60)
            : null,
        })),
      };
    } catch (error) {
      this.logger.error(
        `Error fetching completed interviews: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Helper: Get file extension from filename or mimetype
   */
  private getFileExtension(filename: string, mimetype: string): string {
    if (filename && filename.includes('.')) {
      return filename.substring(filename.lastIndexOf('.'));
    }

    const mimetypeMap: { [key: string]: string } = {
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/ogg': '.ogg',
      'video/quicktime': '.mov',
      'video/x-msvideo': '.avi',
      'video/x-matroska': '.mkv',
    };

    return mimetypeMap[mimetype] || '.mp4';
  }
}

