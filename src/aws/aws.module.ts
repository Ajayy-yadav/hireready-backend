import { Module } from '@nestjs/common';
import { AwsService } from './awsClient.service';
import { AwsController } from './aws.controller';

@Module({
  controllers: [AwsController],
  providers: [AwsService],
  exports: [AwsService],
})

export class AwsModule {}
