-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE', 'MULTI');

-- AlterTable
ALTER TABLE "AdvisorProfile" ADD COLUMN     "pricePerMeetingDkk" INTEGER NOT NULL DEFAULT 1750;

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "cvrData" JSONB,
ADD COLUMN     "cvrVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "testAnswers" JSONB;

-- AlterTable
ALTER TABLE "SubscriptionAdvisor" ADD COLUMN     "pricePerMeetingDkk" INTEGER NOT NULL DEFAULT 1750;

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvisorTag" (
    "advisorId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "AdvisorTag_pkey" PRIMARY KEY ("advisorId","tagId")
);

-- CreateTable
CREATE TABLE "OnboardingQuestion" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "helpText" TEXT,
    "type" "QuestionType" NOT NULL DEFAULT 'SINGLE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingAnswer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "boardSize" INTEGER,

    CONSTRAINT "OnboardingAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerTagWeight" (
    "answerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "AnswerTagWeight_pkey" PRIMARY KEY ("answerId","tagId")
);

-- CreateTable
CREATE TABLE "OnboardingSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL DEFAULT '{}',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "suggestedBoard" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "AdvisorTag_tagId_idx" ON "AdvisorTag"("tagId");

-- CreateIndex
CREATE INDEX "OnboardingAnswer_questionId_idx" ON "OnboardingAnswer"("questionId");

-- CreateIndex
CREATE INDEX "AnswerTagWeight_tagId_idx" ON "AnswerTagWeight"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingSession_tokenHash_key" ON "OnboardingSession"("tokenHash");

-- CreateIndex
CREATE INDEX "OnboardingSession_expiresAt_idx" ON "OnboardingSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "AdvisorTag" ADD CONSTRAINT "AdvisorTag_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "AdvisorProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvisorTag" ADD CONSTRAINT "AdvisorTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingAnswer" ADD CONSTRAINT "OnboardingAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "OnboardingQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerTagWeight" ADD CONSTRAINT "AnswerTagWeight_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "OnboardingAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerTagWeight" ADD CONSTRAINT "AnswerTagWeight_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Datamigrering: eksisterende fritekst-ekspertise bliver til tags (ét tag pr. unik værdi) og kobles til rådgiverne.
INSERT INTO "Tag" ("id", "slug", "name", "sortOrder")
SELECT 'tag_' || md5(v.name),
       trim(both '-' from regexp_replace(lower(translate(v.name, 'æøåÆØÅ', 'aoaAOA')), '[^a-z0-9]+', '-', 'g')) || '-' || substr(md5(v.name), 1, 4),
       v.name,
       (row_number() OVER (ORDER BY v.name))::int
FROM (SELECT DISTINCT trim(e) AS name FROM "AdvisorProfile", unnest("expertise") AS e WHERE trim(e) <> '') v;

INSERT INTO "AdvisorTag" ("advisorId", "tagId")
SELECT DISTINCT p."userId", 'tag_' || md5(trim(e))
FROM "AdvisorProfile" p, unnest(p."expertise") AS e
WHERE trim(e) <> '';

-- Eksisterende abonnementer: fastfrys standardprisen som rådgiverpris (formlen er uændret ved 1.750 kr.)
-- (kolonnens default på 1750 er allerede sat ovenfor)

ALTER TABLE "AdvisorProfile" DROP COLUMN "expertise";
