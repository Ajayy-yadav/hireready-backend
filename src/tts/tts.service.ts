import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, DeepgramClient, LiveTTSEvents } from '@deepgram/sdk';

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private deepgramClient: DeepgramClient;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('DEEPGRAM_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'DEEPGRAM_API_KEY not found in environment variables. TTS service may not work properly.',
      );
    }
    this.deepgramClient = createClient(apiKey);
  }

  /**
   * Convert text to speech using REST API (single request)
   * @param text - The text to convert to speech
   * @returns Audio buffer
   */
  async textToSpeech(text: string): Promise<Buffer> {
    try {
      const options = {
        model: 'aura-2-thalia-en',
        encoding: 'linear16' as const,
        sample_rate: 24000,
        container: 'wav',
      };

      this.logger.log(`Converting text to speech with model: ${options.model}`);

      const response = await this.deepgramClient.speak.request(
        { text },
        options,
      );

      const stream = await response.getStream();
      if (!stream) {
        throw new Error('Failed to get audio stream from Deepgram');
      }

      // Convert ReadableStream to Buffer
      const audioBuffer = await this.streamToBuffer(stream);
      
      this.logger.log(`Successfully generated audio of size: ${audioBuffer.length} bytes`);
      return audioBuffer;
    } catch (error) {
      this.logger.error(`Error in textToSpeech: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Create a streaming TTS connection for continuous text-to-speech
   * @returns Object with connection methods
   */
  createStreamingConnection() {
    try {
      const options = {
        model: 'aura-2-thalia-en',
        encoding: 'linear16' as const,
        sample_rate: 24000,
        container: 'wav',
      };

      this.logger.log(`Creating streaming TTS connection with model: ${options.model}`);

      const connection = this.deepgramClient.speak.live(options);

      // Set up event handlers
      connection.on(LiveTTSEvents.Open, () => {
        this.logger.log('Streaming TTS connection opened');
      });

      connection.on(LiveTTSEvents.Close, () => {
        this.logger.log('Streaming TTS connection closed');
      });

      connection.on(LiveTTSEvents.Error, (error) => {
        this.logger.error(`Streaming TTS error: ${error}`);
      });

      connection.on(LiveTTSEvents.Metadata, (metadata) => {
        this.logger.debug(`Received metadata: ${JSON.stringify(metadata)}`);
      });

      return {
        connection,
        sendText: (text: string) => {
          connection.sendText(text);
        },
        flush: () => {
          connection.flush();
        },
        onAudio: (callback: (audio: Uint8Array) => void) => {
          connection.on(LiveTTSEvents.Audio, callback);
        },
        onMetadata: (callback: (metadata: any) => void) => {
          connection.on(LiveTTSEvents.Metadata, callback);
        },
        onWarning: (callback: (warning: any) => void) => {
          connection.on(LiveTTSEvents.Warning, callback);
        },
        onError: (callback: (error: any) => void) => {
          connection.on(LiveTTSEvents.Error, callback);
        },
      };
    } catch (error) {
      this.logger.error(`Error creating streaming connection: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Convert a ReadableStream to Buffer
   */
  private async streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      return Buffer.from(result);
    } finally {
      reader.releaseLock();
    }
  }
}
