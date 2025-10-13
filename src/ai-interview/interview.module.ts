import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InterviewGateway } from './interview.gateway';
import { InterviewService } from './interview.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SttModule } from '../stt/stt.module';
import { TtsModule } from '../tts/tts.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    SttModule,
    TtsModule,
    LlmModule,
  ],
  providers: [InterviewGateway, InterviewService],
  exports: [InterviewService],
})
export class InterviewModule {}


