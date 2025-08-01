import { Injectable } from '@nestjs/common';
import { StorageClient } from '@supabase/storage-js';

@Injectable()
export class SupabaseStorageService {
  private storage;

  constructor() {
    this.storage = new StorageClient(
      process.env.ENDPOINT_URL!,
      {
        Authorization: `Bearer ${process.env.S3_SECRET_KEY}`,
        apikey: process.env.S3_ACCESS_KEY!
      }
    );
  }

  

  async uploadFile(bucket: string, path: string, file: Buffer, contentType: string) {
    const { data, error } = await this.storage
      .from(bucket)
      .upload(path, file, { contentType, upsert: true });
    if (error) throw error;
    return data;
  }

  getPublicUrl(bucket: string, path: string) {
    return this.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  async downloadFile(bucket: string, path: string) {
    const { data, error } = await this.storage.from(bucket).download(path);
    if (error) throw error;
    return data;
  }
}