import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class AwsService {
  private readonly logger = new Logger(AwsService.name);
  private readonly s3Client: S3Client;

  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_S3_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

  }

  async uploadFile(
    key: string,
    body: Buffer | Uint8Array | Blob | string,
    contentType: string,
    
  ) {
    try {
      const command = new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: key,
        Body: body,
        ContentType: contentType,
      });
      const response = await this.s3Client.send(command);
      return { key: key };
    } catch (error) {
      this.logger.error(`Failed to upload file: ${error.message}`);
      throw error;
    }
  }

  async deleteFile(key: string) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: key,
      });
      const response = await this.s3Client.send(command);
      this.logger.log(`File deleted successfully.`);
      return response;
    } catch (error) {
      this.logger.error(`Failed to delete file: ${error.message}`);
      throw error;
    }
  }

  async getFile( key: string) {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: key,
      });
      const response = await this.s3Client.send(command);
      this.logger.log(`File retrieved successfully.`);
      return response;
    } catch (error) {
      this.logger.error(`Failed to retrieve file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a short-lived signed URL for S3 object access
   * @param key - S3 object key
   * @param expiresIn - Expiration time in seconds (default: 1 hour)
   * @returns Signed URL
   */
  async generateShortLivedSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: key,
      });
      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresIn,
      });
      this.logger.log('signedUrl', signedUrl);
      this.logger.log(`Short-lived signed URL generated for key: ${key}`);
      return signedUrl;
    } catch (error) {
      this.logger.error(`Failed to generate short-lived signed URL: ${error.message}`);
      throw error;
    }
  }

  async generateShortLivedSignedUrlWithContentType(key: string, expiresIn = 3600): Promise<{ signedUrl: string; contentType: string }> {
    try {
      // First check if the object exists
      const headCommand = new HeadObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: key,
      });
      
      const headResponse = await this.s3Client.send(headCommand);
      const contentType = headResponse.ContentType || 'application/octet-stream';
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: key,
      });
      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresIn,
      });
      
      this.logger.log(`Short-lived signed URL generated for key: ${key}`);
      return { signedUrl, contentType };
    } catch (error) {
      if (error.name === 'NotFound') {
        this.logger.error(`Object not found in bucket: ${key}`);
        throw new Error(`Object not found: ${key}`);
      }
      this.logger.error(`Failed to generate short-lived signed URL: ${error.message}`);
      throw error;
    }
  }

  async getSignedUrl(key: string) {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: key,
      });
      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: 12 * 60 * 60,
      });
      this.logger.log(`Signed URL generated successfully.`);
      return signedUrl;
    } catch (error) {
      this.logger.error(`Failed to generate signed URL: ${error.message}`);
      throw error;
    }
  }

}
