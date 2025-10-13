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

      this.logger.log(`🚀 Generating all ${totalQuestions} questions upfront...`);
      
      // Generate ALL questions at once (single LLM call!)
      const allQuestions = await this.llmService.generateAllQuestions(
        dto.jobDescription,
        totalQuestions,
      );

      this.logger.log(`✅ Generated ${allQuestions.length} questions in one call!`);

      // Create session with pre-generated questions
      const session = await this.prisma.interviewSession.create({
        data: {
          userId: dto.userId,
          jobDescription: dto.jobDescription,
          totalQuestions,
          currentQuestion: 1, // Start at 1 since we're showing the first question
          status: 'in_progress',
          history: [],
          // Store questions in metadata for quick access
          metadata: {
            questions: allQuestions,
          },
        },
      });

      this.logger.log(`Interview session started: ${session.id}`);

      // Add first question to history
      await this.addToHistory(session.id, 'assistant', allQuestions[0]);

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
      this.logger.log(`⚡ Processing transcript for session: ${sessionId}`);
      this.logger.log(`Answer: ${userAnswer}`);

      // Step 1: Save user answer to history
      await this.addToHistory(sessionId, 'user', userAnswer);

      // Step 2: Update session progress
      const session = await this.prisma.interviewSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new Error('Interview session not found');
      }

      const updatedSession = await this.prisma.interviewSession.update({
        where: { id: sessionId },
        data: {
          currentQuestion: session.currentQuestion + 1,
        },
      });
      
      this.logger.log(`✅ Progress: ${updatedSession.currentQuestion}/${updatedSession.totalQuestions}`);

      // Step 3: Check if interview is complete
      // currentQuestion represents the question we're NOW on (after answering previous)
      // So we're complete when currentQuestion EXCEEDS totalQuestions
      const isComplete = updatedSession.currentQuestion > updatedSession.totalQuestions;

      if (isComplete) {
        this.logger.log('🎉 Interview complete!');
        await this.prisma.interviewSession.update({
          where: { id: sessionId },
          data: {
            status: 'completed',
            completedAt: new Date(),
          },
        });
        
        return {
          transcript: userAnswer,
          question: null,
          questionAudio: null,
          currentQuestion: updatedSession.currentQuestion,
          totalQuestions: updatedSession.totalQuestions,
          isComplete: true,
        };
      }

      // Step 4: Get pre-generated next question (NO LLM CALL!)
      const metadata = updatedSession.metadata as any;
      const preGeneratedQuestions = metadata?.questions || [];
      
      // Current question index (0-based)
      const nextQuestionIndex = updatedSession.currentQuestion - 1;
      const nextQuestion = preGeneratedQuestions[nextQuestionIndex];

      if (!nextQuestion) {
        this.logger.error('No pre-generated question found, falling back to LLM');
        // Fallback to old method if questions weren't pre-generated
        const generatedQuestion = await this.generateNextQuestion(sessionId);
        const questionAudio = await this.ttsService.textToSpeech(generatedQuestion);
        
        return {
          transcript: userAnswer,
          question: generatedQuestion,
          questionAudio,
          currentQuestion: updatedSession.currentQuestion,
          totalQuestions: updatedSession.totalQuestions,
          isComplete: false,
        };
      }

      this.logger.log(`⚡ Using pre-generated question (no LLM delay!): ${nextQuestion.substring(0, 50)}...`);

      // Add to history
      await this.addToHistory(sessionId, 'assistant', nextQuestion);

      // Step 5: Convert question to speech using TTS (only delay now!)
      const questionAudio = await this.ttsService.textToSpeech(nextQuestion);
      this.logger.log(`✅ Audio generated, size: ${questionAudio.length} bytes`);

      return {
        transcript: userAnswer,
        question: nextQuestion,
        questionAudio,
        currentQuestion: updatedSession.currentQuestion,
        totalQuestions: updatedSession.totalQuestions,
        isComplete: false,
      };
    } catch (error) {
      this.logger.error(`❌ Error in processTranscript: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Process audio input from user (STT -> LLM -> TTS)
   * @deprecated Use processTranscript with live STT for better performance
   */
  async processAudioInput(sessionId: string, audioBuffer: Buffer) {
    try {
      this.logger.log(`Processing audio for session: ${sessionId}, size: ${audioBuffer.length} bytes`);

      // Step 1: Transcribe audio using STT
      this.logger.log('Step 1: Starting STT transcription...');
      const transcriptionResult = await this.sttService.transcribeFromFile(audioBuffer);
      const userAnswer = this.sttService.extractTranscript(transcriptionResult);

      if (!userAnswer || userAnswer.trim().length === 0) {
        this.logger.error('STT returned empty transcript');
        throw new Error('No speech detected in audio');
      }

      this.logger.log(`Step 1 Complete: Transcribed answer: ${userAnswer}`);

      // Step 2: Save user answer to history
      this.logger.log('Step 2: Saving answer to history...');
      await this.addToHistory(sessionId, 'user', userAnswer);
      this.logger.log('Step 2 Complete: Answer saved');

      // Step 3: Update session progress FIRST
      this.logger.log('Step 3: Updating session progress...');
      const session = await this.prisma.interviewSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        this.logger.error(`Session not found: ${sessionId}`);
        throw new Error('Interview session not found');
      }

      const updatedSession = await this.prisma.interviewSession.update({
        where: { id: sessionId },
        data: {
          currentQuestion: session.currentQuestion + 1,
        },
      });
      
      this.logger.log(`Step 3 Complete: Progress updated to ${updatedSession.currentQuestion}/${updatedSession.totalQuestions}`);

      // Step 4: Check if interview is complete BEFORE generating next question
      const isComplete = updatedSession.currentQuestion >= updatedSession.totalQuestions;

      if (isComplete) {
        this.logger.log('Interview complete! No more questions to generate. Marking as completed...');
        await this.prisma.interviewSession.update({
          where: { id: sessionId },
          data: {
            status: 'completed',
            completedAt: new Date(),
          },
        });
        this.logger.log(`Interview session completed: ${sessionId}`);
        
        // Return without generating next question
        return {
          transcript: userAnswer,
          question: null, // No next question
          questionAudio: null, // No audio
          currentQuestion: updatedSession.currentQuestion,
          totalQuestions: updatedSession.totalQuestions,
          isComplete: true,
        };
      }

      // Step 5: Generate next question using LLM (only if not complete)
      this.logger.log('Step 4: Generating next question with LLM...');
      const nextQuestion = await this.generateNextQuestion(sessionId);
      this.logger.log(`Step 4 Complete: Generated question: ${nextQuestion.substring(0, 50)}...`);

      // Step 6: Convert question to speech using TTS
      this.logger.log('Step 5: Converting question to speech...');
      const questionAudio = await this.ttsService.textToSpeech(nextQuestion);
      this.logger.log(`Step 5 Complete: Audio generated, size: ${questionAudio.length} bytes`);

      this.logger.log('All steps complete! Returning result...');

      return {
        transcript: userAnswer,
        question: nextQuestion,
        questionAudio,
        currentQuestion: updatedSession.currentQuestion,
        totalQuestions: updatedSession.totalQuestions,
        isComplete: false,
      };
    } catch (error) {
      this.logger.error(`❌ Error in processAudioInput: ${error.message}`, error.stack);
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

      // Get LLM response
      const question = await this.llmService.llmResponse(
        session.jobDescription,
        history as ConversationHistory[],
      );

      // Save assistant question to history
      await this.addToHistory(sessionId, 'assistant', question);

      this.logger.log(`Generated question: ${question}`);

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

      this.logger.debug(`Added to history [${role}]: ${content.substring(0, 50)}...`);
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
      // Check if session exists
      const session = await this.prisma.interviewSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new NotFoundException('Interview session not found');
      }

      // Generate file extension
      const fileExtension = this.getFileExtension(
        video.originalname,
        video.mimetype,
      );
      const s3Key = `interview-recordings/${sessionId}/${crypto.randomUUID()}${fileExtension}`;

      this.logger.log(`Uploading video to S3: ${s3Key}`);

      // Upload to S3
      const uploadResult = await this.awsService.uploadFile(
        s3Key,
        video.buffer,
        video.mimetype,
      );

      // Update session with video key
      await this.prisma.interviewSession.update({
        where: { id: sessionId },
        data: { videoRecordingKey: uploadResult.key },
      });

      this.logger.log(`Video uploaded successfully: ${s3Key}`);

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

      // Check if feedback already exists (return cached feedback)
      if (session.feedback && typeof session.feedback === 'object') {
        this.logger.log(`Returning cached feedback for session ${sessionId}`);
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

      this.logger.log(`Generating feedback for ${history.length} messages`);

      // Generate comprehensive feedback using LLM
      const feedback = await this.llmService.generateInterviewFeedback(
        session.jobDescription,
        history,
      );

      // Store feedback in database
      await this.prisma.interviewSession.update({
        where: { id: sessionId },
        data: { feedback },
      });

      this.logger.log(`Feedback generated and stored for session ${sessionId}`);

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

      this.logger.log(`Found ${completedInterviews.length} completed interviews for user ${userId}`);

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
          hasVideoRecording: !!interview.videoRecordingKey,
          startedAt: interview.startedAt,
          completedAt: interview.completedAt,
          duration: interview.completedAt && interview.startedAt
            ? Math.floor((interview.completedAt.getTime() - interview.startedAt.getTime()) / 1000 / 60) // Duration in minutes
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

