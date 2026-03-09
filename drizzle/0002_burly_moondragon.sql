WITH ranked_friend_requests AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (
			PARTITION BY "project_id", "from_user_id", "to_user_id", "status"
			ORDER BY "created_at" ASC NULLS LAST, "id" ASC
		) AS "row_num"
	FROM "friend_requests"
)
DELETE FROM "friend_requests"
WHERE "id" IN (
	SELECT "id"
	FROM ranked_friend_requests
	WHERE "row_num" > 1
);--> statement-breakpoint
WITH ranked_friends AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (
			PARTITION BY "project_id", "user_id", "friend_id"
			ORDER BY "created_at" ASC NULLS LAST, "id" ASC
		) AS "row_num"
	FROM "friends"
)
DELETE FROM "friends"
WHERE "id" IN (
	SELECT "id"
	FROM ranked_friends
	WHERE "row_num" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "friend_requests_unique_key" ON "friend_requests" USING btree ("project_id","from_user_id","to_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "friends_unique_key" ON "friends" USING btree ("project_id","user_id","friend_id");
