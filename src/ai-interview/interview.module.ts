import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InterviewGateway } from './interview.gateway';
import { InterviewService } from './interview.service';
import { InterviewController } from './interview.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SttModule } from '../stt/stt.module';
import { TtsModule } from '../tts/tts.module';
import { LlmModule } from '../llm/llm.module';
import { AwsModule } from '../aws/aws.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    SttModule,
    TtsModule,
    LlmModule,
    AwsModule,
  ],
  controllers: [InterviewController],
  providers: [InterviewGateway, InterviewService],
  exports: [InterviewService],
})
export class InterviewModule {}


