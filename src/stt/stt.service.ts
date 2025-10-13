import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  DeepgramClient,
  LiveTranscriptionEvents,
  PrerecordedSchema,
  LiveSchema,
} from '@deepgram/sdk';
import { Readable } from 'stream';

export interface TranscriptionResult {
  results: any;
  metadata?: any;
}

@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);
  private deepgramClient: DeepgramClient;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('DEEPGRAM_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'DEEPGRAM_API_KEY not found in environment variables. STT service may not work properly.',
      );
    }
    this.deepgramClient = createClient(apiKey);
  }

  /**
   * Transcribe audio from a URL
   * @param audioUrl - URL of the audio file to transcribe
   * @returns Transcription result
   */
  async transcribeFromUrl(audioUrl: string): Promise<TranscriptionResult> {
    try {
      const options: PrerecordedSchema = {
        model: 'nova-3',
        language: 'en',
        punctuate: true,
        diarize: true,
        smart_format: true,
        utterances: true,
      };

      this.logger.log(`Transcribing audio from URL with model: ${options.model}`);

      const { result, error } = await this.deepgramClient.listen.prerecorded.transcribeUrl(
        { url: audioUrl },
        options,
      );

      if (error) {
        this.logger.error(`Error transcribing from URL: ${error.message}`);
        throw error;
      }

      this.logger.log('Successfully transcribed audio from URL');
      return {
        results: result,
        metadata: result?.metadata,
      };
    } catch (error) {
      this.logger.error(`Error in transcribeFromUrl: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Transcribe audio from a file buffer or stream
   * @param audioSource - Buffer, Readable stream, or file path
   * @returns Transcription result
   */
  async transcribeFromFile(audioSource: Buffer | Readable): Promise<TranscriptionResult> {
    try {
      const options: PrerecordedSchema = {
        model: 'nova-3',
        language: 'en',
        punctuate: true,
        diarize: true,
        smart_format: true,
        utterances: true,
      };

      this.logger.log(`Transcribing audio from file with model: ${options.model}`);

      const { result, error } = await this.deepgramClient.listen.prerecorded.transcribeFile(
        audioSource,
        options,
      );

      if (error) {
        this.logger.error(`Error transcribing from file: ${error.message}`);
        throw error;
      }

      this.logger.log('Successfully transcribed audio from file');
      return {
        results: result,
        metadata: result?.metadata,
      };
    } catch (error) {
      this.logger.error(`Error in transcribeFromFile: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Create a live transcription connection for streaming audio
   * @returns Object with connection methods
   */
  createLiveConnection() {
    try {
      const options: LiveSchema = {
        model: 'nova-3',
        language: 'en',
        punctuate: true,
        smart_format: true,
        interim_results: true,
        endpointing: 2000, // 2 seconds pause triggers UtteranceEnd
        vad_events: true, // Enable Voice Activity Detection
        utterance_end_ms: 2000, // 2 seconds of silence ends an utterance
        // Let Deepgram auto-detect audio format from browser (WebM/Opus)
      };

      this.logger.log(`Creating live transcription connection with model: ${options.model}`);

      const connection = this.deepgramClient.listen.live(options);

      // Set up default event handlers for logging
      connection.on(LiveTranscriptionEvents.Open, () => {
        this.logger.log('Live transcription connection opened');
        
        // Send keepalive every 5 seconds to prevent connection from closing
        const keepAliveInterval = setInterval(() => {
          if (connection.getReadyState() === 1) { // 1 = OPEN
            try {
              connection.keepAlive();
              this.logger.debug('Sent keepalive to Deepgram');
            } catch (error) {
              this.logger.error(`Error sending keepalive: ${error.message}`);
            }
          } else {
            this.logger.warn('Connection not open, stopping keepalive');
            clearInterval(keepAliveInterval);
          }
        }, 5000);

        // Store interval for cleanup
        (connection as any)._keepAliveInterval = keepAliveInterval;
      });

      connection.on(LiveTranscriptionEvents.Close, () => {
        this.logger.log('Live transcription connection closed');
        
        // Clear keepalive interval
        if ((connection as any)._keepAliveInterval) {
          clearInterval((connection as any)._keepAliveInterval);
        }
      });

      connection.on(LiveTranscriptionEvents.Error, (error) => {
        this.logger.error(`Live transcription error: ${JSON.stringify(error)}`);
      });

      connection.on(LiveTranscriptionEvents.Metadata, (metadata) => {
        this.logger.debug(`Received metadata: ${JSON.stringify(metadata)}`);
      });

      return {
        connection,
        send: (audioData: any) => {
          connection.send(audioData);
        },
        finish: () => {
          // Clear keepalive before finishing
          if ((connection as any)._keepAliveInterval) {
            clearInterval((connection as any)._keepAliveInterval);
          }
          connection.finish();
        },
        keepAlive: () => {
          connection.keepAlive();
        },
        getReadyState: () => {
          return connection.getReadyState();
        },
        onTranscript: (callback: (transcript: any) => void) => {
          connection.on(LiveTranscriptionEvents.Transcript, callback);
        },
        onMetadata: (callback: (metadata: any) => void) => {
          connection.on(LiveTranscriptionEvents.Metadata, callback);
        },
        onUtterance: (callback: (utterance: any) => void) => {
          connection.on(LiveTranscriptionEvents.UtteranceEnd, callback);
        },
        onSpeechStarted: (callback: (speech: any) => void) => {
          connection.on(LiveTranscriptionEvents.SpeechStarted, callback);
        },
        onError: (callback: (error: any) => void) => {
          connection.on(LiveTranscriptionEvents.Error, callback);
        },
      };
    } catch (error) {
      this.logger.error(`Error creating live connection: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get transcript text from transcription result
   * @param result - Transcription result
   * @returns Extracted text transcript
   */
  extractTranscript(result: TranscriptionResult): string {
    try {
      const channel = result.results?.results?.channels?.[0];
      const alternatives = channel?.alternatives?.[0];
      return alternatives?.transcript || '';
    } catch (error) {
      this.logger.error(`Error extracting transcript: ${error.message}`);
      return '';
    }
  }

  /**
   * Get word-level details from transcription result
   * @param result - Transcription result
   * @returns Array of words with timing information
   */
  extractWords(result: TranscriptionResult): any[] {
    try {
      const channel = result.results?.results?.channels?.[0];
      const alternatives = channel?.alternatives?.[0];
      this.logger.log(`Extracted words: ${JSON.stringify(alternatives?.words)}`);
      return alternatives?.words || [];
    } catch (error) {
      this.logger.error(`Error extracting words: ${error.message}`);
      return [];
    }
  }
}

