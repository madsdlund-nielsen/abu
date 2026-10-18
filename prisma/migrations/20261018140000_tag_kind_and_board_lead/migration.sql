-- Tag-typer (kompetence/admin) og ansvarlig rådgiver (lead) pr. board.
CREATE TYPE "TagKind" AS ENUM ('COMPETENCE', 'ADMIN');

ALTER TABLE "Tag" ADD COLUMN "kind" "TagKind" NOT NULL DEFAULT 'COMPETENCE',
ADD COLUMN "systemKey" TEXT;

CREATE UNIQUE INDEX "Tag_systemKey_key" ON "Tag"("systemKey");

ALTER TABLE "SubscriptionAdvisor" ADD COLUMN "isLead" BOOLEAN NOT NULL DEFAULT false;

-- Højst én ansvarlig rådgiver pr. abonnement
CREATE UNIQUE INDEX "SubscriptionAdvisor_one_lead_per_subscription" ON "SubscriptionAdvisor"("subscriptionId") WHERE "isLead";

-- Systemtagget «Lead-kvalificeret» (internt admin-tag). Findes slug'en allerede, får det eksisterende tag nøglen.
INSERT INTO "Tag" ("id", "slug", "name", "description", "sortOrder", "active", "kind", "systemKey")
VALUES ('tag_system_lead', 'lead-kvalificeret', 'Lead-kvalificeret', 'Kan være ansvarlig rådgiver for et board. Internt – vises aldrig for kunder.', 1000, true, 'ADMIN', 'lead')
ON CONFLICT ("slug") DO UPDATE SET "kind" = 'ADMIN', "systemKey" = 'lead', "active" = true;
