import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { APP_GUARD } from '@nestjs/core';
import { UserModule } from './user/user.module';
import { PrismaService } from './prisma/prisma.service';
import { AwsModule } from './aws/aws.module';
import { ResumeAnalysisModule } from './resume-analysis/resume-analysis.module';
import { InterviewModule } from './ai-interview/interview.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule, 
    UserModule, 
    AwsModule,
    ResumeAnalysisModule,
    InterviewModule,
  ],
  controllers: [AppController],
  providers: [
    PrismaService,
    // {
    //   provide: APP_GUARD,
    //   useClass: JwtAuthGuard,
    // }
  ],
})
export class AppModule {}
