ALTER TABLE "profiles"
ADD COLUMN "provider_nickname" text;

UPDATE "profiles"
SET "provider_nickname" = "nickname"
WHERE "provider_nickname" IS NULL;
