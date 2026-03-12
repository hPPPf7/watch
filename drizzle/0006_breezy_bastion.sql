CREATE TABLE "auth_session_states" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "session_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

INSERT INTO "auth_session_states" ("user_id", "session_version")
SELECT "user_id", 1
FROM (
  SELECT "id" AS "user_id" FROM "profiles"
  UNION
  SELECT "user_id" FROM "auth_user_map"
) AS existing_users
ON CONFLICT ("user_id") DO NOTHING;
