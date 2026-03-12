DELETE FROM "watch_history_shares" AS "shares"
WHERE NOT EXISTS (
  SELECT 1
  FROM "watch_history" AS "history"
  WHERE "history"."id" = "shares"."watch_history_id"
);
--> statement-breakpoint
ALTER TABLE "watch_history_shares"
ADD CONSTRAINT "watch_history_shares_watch_history_id_watch_history_id_fk"
FOREIGN KEY ("watch_history_id")
REFERENCES "public"."watch_history"("id")
ON DELETE cascade
ON UPDATE no action;
