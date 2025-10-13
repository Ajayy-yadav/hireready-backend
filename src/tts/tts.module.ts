import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TtsService } from './tts.service';

@Module({
  imports: [ConfigModule],
  providers: [TtsService],
  exports: [TtsService],
})
export class TtsModule {}
