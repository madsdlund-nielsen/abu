-- AlterEnum
ALTER TYPE "RecordingStatus" ADD VALUE 'UPLOADING';

-- AlterTable
ALTER TABLE "Recording" ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "uploadedById" TEXT;

