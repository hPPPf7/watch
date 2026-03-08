import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { publishWatchUpdates } from "@/server/realtime/watchUpdates";
import {
  friendRequests,
  friends,
  profiles,
  watchHistoryShares,
} from "@/server/db/schema";

const PROJECT_ID = "watch";

export class FriendServiceError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function assertUuid(value: string, field: string) {
  if (!/^[0-9a-fA-F-]{36}$/.test(value)) {
    throw new FriendServiceError("BAD_REQUEST", `${field} must be a UUID`, 400);
  }
}

async function getProfile(userId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: profiles.id,
      nickname: profiles.nickname,
      avatarUrl: profiles.avatarUrl,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getFriendSummary(viewerId: string) {
  const db = getDb();

  const incomingRows = await db
    .select({
      id: friendRequests.id,
      fromUserId: friendRequests.fromUserId,
      fromNickname: friendRequests.fromNickname,
      createdAt: friendRequests.createdAt,
      profileNickname: profiles.nickname,
      profileAvatarUrl: profiles.avatarUrl,
    })
    .from(friendRequests)
    .leftJoin(profiles, eq(friendRequests.fromUserId, profiles.id))
    .where(
      and(
        eq(friendRequests.projectId, PROJECT_ID),
        eq(friendRequests.toUserId, viewerId),
        eq(friendRequests.status, "pending")
      )
    )
    .orderBy(desc(friendRequests.createdAt));

  const outgoingRows = await db
    .select({
      id: friendRequests.id,
      toUserId: friendRequests.toUserId,
      createdAt: friendRequests.createdAt,
      profileNickname: profiles.nickname,
      profileAvatarUrl: profiles.avatarUrl,
    })
    .from(friendRequests)
    .leftJoin(profiles, eq(friendRequests.toUserId, profiles.id))
    .where(
      and(
        eq(friendRequests.projectId, PROJECT_ID),
        eq(friendRequests.fromUserId, viewerId),
        eq(friendRequests.status, "pending")
      )
    )
    .orderBy(desc(friendRequests.createdAt));

  const friendRows = await db
    .select({
      friendId: friends.friendId,
      friendNickname: friends.friendNickname,
      createdAt: friends.createdAt,
      profileNickname: profiles.nickname,
      profileAvatarUrl: profiles.avatarUrl,
    })
    .from(friends)
    .leftJoin(profiles, eq(friends.friendId, profiles.id))
    .where(and(eq(friends.projectId, PROJECT_ID), eq(friends.userId, viewerId)))
    .orderBy(desc(friends.createdAt));

  return {
    incoming: incomingRows.map((row) => ({
      id: row.id,
      fromUserId: row.fromUserId,
      fromNickname: row.profileNickname ?? row.fromNickname,
      avatarUrl: row.profileAvatarUrl ?? null,
      createdAt: row.createdAt,
    })),
    outgoing: outgoingRows.map((row) => ({
      id: row.id,
      toUserId: row.toUserId,
      toNickname: row.profileNickname ?? null,
      avatarUrl: row.profileAvatarUrl ?? null,
      createdAt: row.createdAt,
    })),
    friends: friendRows.map((row) => ({
      friendId: row.friendId,
      friendNickname: row.profileNickname ?? row.friendNickname,
      avatarUrl: row.profileAvatarUrl ?? null,
      createdAt: row.createdAt,
    })),
  };
}

export async function sendFriendRequest(input: {
  viewerId: string;
  targetUserId: string;
  viewerNickname: string | null;
}) {
  const db = getDb();
  const { viewerId, targetUserId, viewerNickname } = input;

  assertUuid(targetUserId, "targetUserId");
  if (viewerId === targetUserId) {
    throw new FriendServiceError("INVALID_TARGET", "Cannot add yourself", 400);
  }

  const targetProfile = await getProfile(targetUserId);
  if (!targetProfile) {
    throw new FriendServiceError("TARGET_NOT_FOUND", "User not found", 404);
  }

  const existingFriend = await db
    .select({ id: friends.id })
    .from(friends)
    .where(
      and(
        eq(friends.projectId, PROJECT_ID),
        eq(friends.userId, viewerId),
        eq(friends.friendId, targetUserId)
      )
    )
    .limit(1);
  if (existingFriend[0]) {
    throw new FriendServiceError("ALREADY_FRIEND", "Already friends", 409);
  }

  const pendingOutgoing = await db
    .select({ id: friendRequests.id })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.projectId, PROJECT_ID),
        eq(friendRequests.fromUserId, viewerId),
        eq(friendRequests.toUserId, targetUserId),
        eq(friendRequests.status, "pending")
      )
    )
    .limit(1);
  if (pendingOutgoing[0]) {
    throw new FriendServiceError(
      "REQUEST_EXISTS",
      "Outgoing request already exists",
      409
    );
  }

  const pendingIncoming = await db
    .select({ id: friendRequests.id })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.projectId, PROJECT_ID),
        eq(friendRequests.fromUserId, targetUserId),
        eq(friendRequests.toUserId, viewerId),
        eq(friendRequests.status, "pending")
      )
    )
    .limit(1);
  if (pendingIncoming[0]) {
    throw new FriendServiceError(
      "REQUEST_EXISTS_REVERSE",
      "Incoming request already exists",
      409
    );
  }

  await db.insert(friendRequests).values({
    id: randomUUID(),
    projectId: PROJECT_ID,
    fromUserId: viewerId,
    toUserId: targetUserId,
    fromNickname: viewerNickname,
    status: "pending",
  });
}

export async function acceptFriendRequest(input: {
  viewerId: string;
  requestId: string;
}) {
  const db = getDb();
  const { viewerId, requestId } = input;
  assertUuid(viewerId, "viewerId");
  assertUuid(requestId, "requestId");

  const pending = await db
    .select({ fromUserId: friendRequests.fromUserId })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.id, requestId),
        eq(friendRequests.projectId, PROJECT_ID),
        eq(friendRequests.toUserId, viewerId),
        eq(friendRequests.status, "pending")
      )
    )
    .limit(1);

  const fromUserId = pending[0]?.fromUserId;
  if (!fromUserId) {
    throw new FriendServiceError("REQUEST_NOT_FOUND", "Request not found", 404);
  }

  await db
    .delete(friendRequests)
    .where(
      and(
        eq(friendRequests.id, requestId),
        eq(friendRequests.projectId, PROJECT_ID),
        eq(friendRequests.toUserId, viewerId),
        eq(friendRequests.status, "pending")
      )
    );

  const [fromProfile, viewerProfile] = await Promise.all([
    getProfile(fromUserId),
    getProfile(viewerId),
  ]);

  const hasViewerToFrom = await db
    .select({ id: friends.id })
    .from(friends)
    .where(
      and(
        eq(friends.projectId, PROJECT_ID),
        eq(friends.userId, viewerId),
        eq(friends.friendId, fromUserId)
      )
    )
    .limit(1);

  if (!hasViewerToFrom[0]) {
    await db.insert(friends).values({
      id: randomUUID(),
      projectId: PROJECT_ID,
      userId: viewerId,
      friendId: fromUserId,
      friendNickname: fromProfile?.nickname ?? null,
    });
  }

  const hasFromToViewer = await db
    .select({ id: friends.id })
    .from(friends)
    .where(
      and(
        eq(friends.projectId, PROJECT_ID),
        eq(friends.userId, fromUserId),
        eq(friends.friendId, viewerId)
      )
    )
    .limit(1);

  if (!hasFromToViewer[0]) {
    await db.insert(friends).values({
      id: randomUUID(),
      projectId: PROJECT_ID,
      userId: fromUserId,
      friendId: viewerId,
      friendNickname: viewerProfile?.nickname ?? null,
    });
  }
}

export async function rejectFriendRequest(input: {
  viewerId: string;
  requestId: string;
}) {
  const db = getDb();
  const { viewerId, requestId } = input;
  assertUuid(requestId, "requestId");

  const rows = await db
    .delete(friendRequests)
    .where(
      and(
        eq(friendRequests.id, requestId),
        eq(friendRequests.projectId, PROJECT_ID),
        eq(friendRequests.toUserId, viewerId),
        eq(friendRequests.status, "pending")
      )
    )
    .returning({ id: friendRequests.id });

  if (!rows[0]) {
    throw new FriendServiceError("REQUEST_NOT_FOUND", "Request not found", 404);
  }
}

export async function revokeOutgoingFriendRequest(input: {
  viewerId: string;
  requestId: string;
}) {
  const db = getDb();
  const { viewerId, requestId } = input;
  assertUuid(requestId, "requestId");

  const rows = await db
    .delete(friendRequests)
    .where(
      and(
        eq(friendRequests.id, requestId),
        eq(friendRequests.projectId, PROJECT_ID),
        eq(friendRequests.fromUserId, viewerId),
        eq(friendRequests.status, "pending")
      )
    )
    .returning({ id: friendRequests.id });

  if (!rows[0]) {
    throw new FriendServiceError("REQUEST_NOT_FOUND", "Request not found", 404);
  }
}

export async function removeFriend(input: { viewerId: string; targetUserId: string }) {
  const db = getDb();
  const { viewerId, targetUserId } = input;
  assertUuid(targetUserId, "targetUserId");

  // 產品規則：
  // 1. 共同觀看好友是和紀錄建立者綁定的關係，不是永久公開名單。
  // 2. 建立者與被分享好友解除朋友關係時，要直接把該好友從同步紀錄移除。
  // 3. 被分享好友解除與建立者的好友時，也等同把自己從該同步紀錄移除。
  // 因此解除好友不只刪 friends / friend_requests，也要刪掉這一對使用者之間的
  // watch_history_shares，讓各頁面不再顯示這段共同觀看關係。
  await db.execute(sql`
    WITH del_friends AS (
      DELETE FROM ${friends}
      WHERE ${friends.projectId} = ${PROJECT_ID}
        AND (
          (${friends.userId} = ${viewerId} AND ${friends.friendId} = ${targetUserId})
          OR (${friends.userId} = ${targetUserId} AND ${friends.friendId} = ${viewerId})
        )
    ),
    del_history_shares AS (
      DELETE FROM ${watchHistoryShares}
      WHERE ${watchHistoryShares.projectId} = ${PROJECT_ID}
        AND (
          (${watchHistoryShares.ownerId} = ${viewerId} AND ${watchHistoryShares.targetUserId} = ${targetUserId})
          OR (${watchHistoryShares.ownerId} = ${targetUserId} AND ${watchHistoryShares.targetUserId} = ${viewerId})
        )
    ),
    del_requests AS (
      DELETE FROM ${friendRequests}
      WHERE ${friendRequests.projectId} = ${PROJECT_ID}
        AND (
          (${friendRequests.fromUserId} = ${viewerId} AND ${friendRequests.toUserId} = ${targetUserId})
          OR (${friendRequests.fromUserId} = ${targetUserId} AND ${friendRequests.toUserId} = ${viewerId})
        )
    )
    SELECT 1;
  `);

  await publishWatchUpdates(
    [viewerId, targetUserId],
    "friend_remove_history_share"
  );
}
