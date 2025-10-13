import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SttService } from './stt.service';

@Module({
  imports: [ConfigModule],
  providers: [SttService],
  exports: [SttService],
})
export class SttModule {}

