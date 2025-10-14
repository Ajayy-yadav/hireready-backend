import { Module } from '@nestjs/common';
import { ResumeAnalysisController } from './resume-analysis.controller';
import { ResumeAnalysisService } from './resume-analysis.service';
import { PrismaModule } from '../prisma/prisma.module';


@Module({
  imports: [PrismaModule],
  controllers: [ResumeAnalysisController],
  providers: [ResumeAnalysisService],
  exports: [ResumeAnalysisService],
})
export class ResumeAnalysisModule {}
