import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { InterviewService } from './interview.service';
import { SttService } from '../stt/stt.service';
import { PrismaService } from '../prisma/prisma.service';
import { StartInterviewDto } from './dto/start-interview.dto';
import { InterviewMessage } from './dto/interview-message.dto';

interface ActiveSession {
  sessionId: string;
  userId: string;
  liveSTT: any; // Live STT connection
  transcript: string;
  isProcessing: boolean;
  isFinalizing: boolean;
}

@WebSocketGateway({
  cors: {
    origin: '*', // Configure appropriately for production
    credentials: true,
  },
  namespace: '/interview',
})
export class InterviewGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(InterviewGateway.name);
  private activeSessions = new Map<string, ActiveSession>();

  constructor(
    private interviewService: InterviewService,
    private sttService: SttService,
    private prisma: PrismaService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    
    // Clean up active session
    const session = this.activeSessions.get(client.id);
    if (session) {
      // Close STT connection
      if (session.liveSTT) {
        session.liveSTT.finish();
      }
      this.activeSessions.delete(client.id);
    }
  }

  /**
   * Setup live STT connection with automatic UtteranceEnd processing
   */
  private setupLiveSTT(client: Socket, session: ActiveSession) {
    this.logger.log(`🎤 Setting up live STT connection for session: ${session.sessionId}`);
    const liveSTT = this.sttService.createLiveConnection();

    // Handle real-time transcripts
    liveSTT.onTranscript((data) => {
      if (data.is_final) {
        const text = data.channel?.alternatives?.[0]?.transcript || '';
        if (text) {
          session.transcript += (session.transcript ? ' ' : '') + text;
          this.logger.debug(`Live transcript (final): ${text}`);
          
          // Send interim transcript to client for real-time feedback
          client.emit('interim_transcript', {
            type: 'transcript',
            content: session.transcript,
            isFinal: true,
          });
        }
      } else {
        // Interim results - show but don't save
        const text = data.channel?.alternatives?.[0]?.transcript || '';
        if (text) {
          client.emit('interim_transcript', {
            type: 'transcript',
            content: session.transcript + (session.transcript ? ' ' : '') + text,
            isFinal: false,
          });
        }
      }
    });

    // ⭐ KEY FEATURE: Auto-process on UtteranceEnd (2s pause)
    liveSTT.onUtterance(async (utterance) => {
      this.logger.log(`🎯 UtteranceEnd detected - transcript length: ${session.transcript.length}`);
      
      // Prevent duplicate processing
      if (session.isFinalizing || session.isProcessing) {
        this.logger.debug('Already processing, ignoring UtteranceEnd');
        return;
      }

      // Only process if we have transcript with actual content
      if (!session.transcript || session.transcript.trim().length === 0) {
        this.logger.debug('Empty transcript on UtteranceEnd, ignoring - waiting for speech');
        return;
      }

      // Only process if transcript has meaningful content (more than a few characters)
      if (session.transcript.trim().length < 3) {
        this.logger.debug('Transcript too short, ignoring UtteranceEnd');
        return;
      }

      this.logger.log(`⚡ Processing answer after 2s pause`);
      
      // Trigger automatic processing (silent, no UI flash)
      await this.autoProcessAnswer(client, session);
    });

    liveSTT.onError((error) => {
      this.logger.error(`Live STT error: ${JSON.stringify(error)}`);
    });

    return liveSTT;
  }

  /**
   * Automatically process the user's answer (triggered by UtteranceEnd)
   * This is silent - no UI flash, just saves and moves to next question
   */
  private async autoProcessAnswer(client: Socket, session: ActiveSession) {
    try {
      if (session.isProcessing || session.isFinalizing) {
        return;
      }

      session.isFinalizing = true;
      session.isProcessing = true;

      const userAnswer = session.transcript.trim();
      
      if (!userAnswer) {
        this.logger.warn('Empty answer on auto-process');
        session.isProcessing = false;
        session.isFinalizing = false;
        return;
      }

      this.logger.log(`⚡ Auto-processing answer: "${userAnswer.substring(0, 50)}..."`);

      // DON'T close STT connection - just mark as finalizing to prevent duplicate processing
      // The connection stays alive for continuous recording

      // Process the answer (save + get next question)
      const result = await this.interviewService.processTranscript(
        session.sessionId,
        userAnswer,
      );

      // Silent save - just emit a subtle confirmation
      client.emit('answer_saved', {
        type: 'status',
        content: 'Answer recorded',
        sessionId: session.sessionId,
      });

      // Clear transcript for next question
      session.transcript = '';

      // Check if interview is complete
      if (result.isComplete) {
        this.logger.log(`🎉 Interview completed: ${session.sessionId}`);
        
        // Close STT connection on completion
        if (session.liveSTT) {
          session.liveSTT.finish();
        }
        
        client.emit('interview_completed', {
          type: 'status',
          sessionId: session.sessionId,
          content: 'Interview completed successfully!',
          currentQuestion: result.currentQuestion,
          totalQuestions: result.totalQuestions,
          isComplete: true,
        });

        // Clean up
        this.activeSessions.delete(client.id);
        return;
      }

      // Send next question instantly
      if (result.question && result.questionAudio) {
        const questionResponse: InterviewMessage = {
          type: 'question',
          sessionId: session.sessionId,
          content: result.question,
          currentQuestion: result.currentQuestion,
          totalQuestions: result.totalQuestions,
          isComplete: false,
        };

        client.emit('next_question', questionResponse);

        // Send audio for the question
        client.emit('question_audio', {
          type: 'audio',
          audio: result.questionAudio.toString('base64'),
          sessionId: session.sessionId,
        });
      }

      // Reset processing flags
      session.isProcessing = false;
      session.isFinalizing = false;

      // Keep the same STT connection alive - no need to restart

    } catch (error) {
      this.logger.error(`Error in auto-process: ${error.message}`, error.stack);
      
      session.isProcessing = false;
      session.isFinalizing = false;
      
      // Restart STT connection on error to ensure continuity
      if (!session.liveSTT || session.liveSTT.connection?.readyState !== 1) {
        this.logger.warn('STT connection lost, restarting...');
        session.liveSTT = this.setupLiveSTT(client, session);
      }
      
      client.emit('interview_error', {
        type: 'error',
        error: error.message || 'Failed to process answer',
      });
    }
  }

  /**
   * Start a new interview session
   */
  @SubscribeMessage('start_interview')
  async handleStartInterview(
    @MessageBody() data: StartInterviewDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      this.logger.log(`🚀 Starting interview for user: ${data.userId}`);

      // Start the interview session (pre-generates ALL questions)
      const result = await this.interviewService.startInterview(data);

      // Initialize active session
      const session: ActiveSession = {
        sessionId: result.sessionId,
        userId: data.userId,
        liveSTT: null,
        transcript: '',
        isProcessing: false,
        isFinalizing: false,
      };
      
      this.activeSessions.set(client.id, session);

      // Setup live STT with automatic UtteranceEnd handling
      session.liveSTT = this.setupLiveSTT(client, session);

      // Send initial question
      const response: InterviewMessage = {
        type: 'question',
        sessionId: result.sessionId,
        content: result.question,
        currentQuestion: result.currentQuestion,
        totalQuestions: result.totalQuestions,
        isComplete: false,
      };

      client.emit('interview_started', response);

      // Generate and send audio for the first question
      const audioBuffer = await this.interviewService['ttsService'].textToSpeech(
        result.question,
      );
      
      client.emit('question_audio', {
        type: 'audio',
        audio: audioBuffer.toString('base64'),
        sessionId: result.sessionId,
      });

      this.logger.log(`✅ Interview started: ${result.sessionId}`);
    } catch (error) {
      this.logger.error(`❌ Error starting interview: ${error.message}`, error.stack);
      
      const errorResponse: InterviewMessage = {
        type: 'error',
        error: error.message || 'Failed to start interview',
      };
      
      client.emit('interview_error', errorResponse);
    }
  }

  /**
   * Handle incoming audio chunks from the user (Real-time STT)
   */
  @SubscribeMessage('audio_chunk')
  async handleAudioChunk(
    @MessageBody() data: { audio: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const session = this.activeSessions.get(client.id);
      
      if (!session) {
        throw new Error('No active interview session');
      }

      if (session.isFinalizing) {
        this.logger.debug('Already finalizing, skipping chunk');
        return;
      }

      // Convert base64 audio to buffer
      const audioBuffer = Buffer.from(data.audio, 'base64');
      this.logger.debug(`📨 Received audio chunk: ${audioBuffer.length} bytes`);
      
      // Send directly to live STT for real-time transcription
      // UtteranceEnd will trigger automatic processing after 2s pause
      if (session.liveSTT) {
        try {
          session.liveSTT.send(audioBuffer);
          this.logger.debug(`✅ Sent ${audioBuffer.length} bytes to STT`);
        } catch (error) {
          this.logger.error(`❌ Error sending to STT: ${error.message}`);
          // Try to recreate connection if it's lost
          this.logger.warn('Recreating STT connection...');
          session.liveSTT = this.setupLiveSTT(client, session);
        }
      } else {
        this.logger.error('❌ No active STT connection to send audio to!');
      }

    } catch (error) {
      this.logger.error(`Error handling audio chunk: ${error.message}`, error.stack);
    }
  }

  /**
   * Manual trigger for finishing recording (kept as fallback)
   * Note: Primary flow uses automatic UtteranceEnd detection
   */
  @SubscribeMessage('finish_recording')
  async handleFinishRecording(@ConnectedSocket() client: Socket) {
    try {
      const session = this.activeSessions.get(client.id);
      
      if (!session) {
        this.logger.warn('No active session for finish_recording');
        return;
      }

      if (session.isFinalizing || session.isProcessing) {
        this.logger.debug('Already processing, ignoring manual trigger');
        return;
      }

      this.logger.log(`📝 Manual finish_recording triggered`);
      
      // Trigger automatic processing
      await this.autoProcessAnswer(client, session);
      
    } catch (error) {
      this.logger.error(`Error finishing recording: ${error.message}`, error.stack);
      client.emit('interview_error', {
        type: 'error',
        error: 'Failed to process recording',
      });
    }
  }

  /**
   * Get interview history
   */
  @SubscribeMessage('get_history')
  async handleGetHistory(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const history = await this.interviewService.getConversationHistory(data.sessionId);
      
      client.emit('interview_history', {
        type: 'status',
        sessionId: data.sessionId,
        content: JSON.stringify(history),
      });
    } catch (error) {
      this.logger.error(`Error getting history: ${error.message}`, error.stack);
      
      client.emit('interview_error', {
        type: 'error',
        error: 'Failed to get interview history',
      });
    }
  }
}

