/*
  Warnings:

  - You are about to drop the column `imageUrl` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `resumeUrl` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "imageUrl",
DROP COLUMN "resumeUrl",
ADD COLUMN     "imageKey" TEXT,
ADD COLUMN     "resumeKey" TEXT;
