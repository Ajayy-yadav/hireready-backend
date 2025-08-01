import { Module } from "@nestjs/common";
import { SupabaseStorageService } from "./supabase-storage-service";
import { UserService } from "src/user/user.service";
import { ResumeController } from "src/resume/resume-controller";
import { PrismaModule } from "src/prisma/prisma.module";


@Module({
     imports: [PrismaModule],
    controllers: [ResumeController],
  providers: [SupabaseStorageService,UserService],
  exports: [SupabaseStorageService],
})
export class SupabaseModule {}