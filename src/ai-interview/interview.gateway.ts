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
    // Client connected
  }

  handleDisconnect(client: Socket) {
    const session = this.activeSessions.get(client.id);
    if (session) {
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
    const liveSTT = this.sttService.createLiveConnection();

    // Handle real-time transcripts
    liveSTT.onTranscript((data) => {
      if (data.is_final) {
        const text = data.channel?.alternatives?.[0]?.transcript || '';
        if (text) {
          session.transcript += (session.transcript ? ' ' : '') + text;
          
          client.emit('interim_transcript', {
            type: 'transcript',
            content: session.transcript,
            isFinal: true,
          });
        }
      } else {
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

    // Auto-process on UtteranceEnd (2s pause)
    liveSTT.onUtterance(async (utterance) => {
      if (session.isFinalizing || session.isProcessing) {
        return;
      }

      if (!session.transcript || session.transcript.trim().length < 3) {
        return;
      }
      
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
        session.isProcessing = false;
        session.isFinalizing = false;
        return;
      }

      const result = await this.interviewService.processTranscript(
        session.sessionId,
        userAnswer,
      );

      client.emit('answer_saved', {
        type: 'status',
        content: 'Answer recorded',
        sessionId: session.sessionId,
      });

      session.transcript = '';

      if (result.isComplete) {
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

        this.activeSessions.delete(client.id);
        return;
      }

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
        client.emit('question_audio', {
          type: 'audio',
          audio: result.questionAudio.toString('base64'),
          sessionId: session.sessionId,
        });
      }

      session.isProcessing = false;
      session.isFinalizing = false;

    } catch (error) {
      this.logger.error(`Error in auto-process: ${error.message}`, error.stack);
      
      session.isProcessing = false;
      session.isFinalizing = false;
      
      if (!session.liveSTT || session.liveSTT.connection?.readyState !== 1) {
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
      const result = await this.interviewService.startInterview(data);

      const session: ActiveSession = {
        sessionId: result.sessionId,
        userId: data.userId,
        liveSTT: null,
        transcript: '',
        isProcessing: false,
        isFinalizing: false,
      };
      
      this.activeSessions.set(client.id, session);
      session.liveSTT = this.setupLiveSTT(client, session);

      const response: InterviewMessage = {
        type: 'question',
        sessionId: result.sessionId,
        content: result.question,
        currentQuestion: result.currentQuestion,
        totalQuestions: result.totalQuestions,
        isComplete: false,
      };

      client.emit('interview_started', response);

      const audioBuffer = await this.interviewService['ttsService'].textToSpeech(
        result.question,
      );
      
      client.emit('question_audio', {
        type: 'audio',
        audio: audioBuffer.toString('base64'),
        sessionId: result.sessionId,
      });
    } catch (error) {
      this.logger.error(`Error starting interview: ${error.message}`, error.stack);
      
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
      
      if (!session || session.isFinalizing) {
        return;
      }

      const audioBuffer = Buffer.from(data.audio, 'base64');
      
      if (session.liveSTT) {
        try {
          session.liveSTT.send(audioBuffer);
        } catch (error) {
          this.logger.error(`Error sending to STT: ${error.message}`);
          session.liveSTT = this.setupLiveSTT(client, session);
        }
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
      
      if (!session || session.isFinalizing || session.isProcessing) {
        return;
      }
      
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

