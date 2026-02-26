import { randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { friendRequests, friends, profiles } from "@/server/db/schema";

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
  assertUuid(requestId, "requestId");

  await db.transaction(async (tx) => {
    const requestRows = await tx
      .select({
        id: friendRequests.id,
        fromUserId: friendRequests.fromUserId,
      })
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

    const request = requestRows[0];
    if (!request) {
      throw new FriendServiceError("REQUEST_NOT_FOUND", "Request not found", 404);
    }

    const [viewerProfile, fromProfile] = await Promise.all([
      tx
        .select({ nickname: profiles.nickname })
        .from(profiles)
        .where(eq(profiles.id, viewerId))
        .limit(1),
      tx
        .select({ nickname: profiles.nickname })
        .from(profiles)
        .where(eq(profiles.id, request.fromUserId))
        .limit(1),
    ]);

    const existing = await tx
      .select({ id: friends.id })
      .from(friends)
      .where(
        and(
          eq(friends.projectId, PROJECT_ID),
          or(
            and(
              eq(friends.userId, viewerId),
              eq(friends.friendId, request.fromUserId)
            ),
            and(
              eq(friends.userId, request.fromUserId),
              eq(friends.friendId, viewerId)
            )
          )
        )
      )
      .limit(1);

    if (!existing[0]) {
      await tx.insert(friends).values([
        {
          id: randomUUID(),
          projectId: PROJECT_ID,
          userId: viewerId,
          friendId: request.fromUserId,
          friendNickname: fromProfile[0]?.nickname ?? null,
        },
        {
          id: randomUUID(),
          projectId: PROJECT_ID,
          userId: request.fromUserId,
          friendId: viewerId,
          friendNickname: viewerProfile[0]?.nickname ?? null,
        },
      ]);
    }

    await tx
      .delete(friendRequests)
      .where(
        and(
          eq(friendRequests.id, requestId),
          eq(friendRequests.projectId, PROJECT_ID)
        )
      );
  });
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

  await db.transaction(async (tx) => {
    await tx
      .delete(friends)
      .where(
        and(
          eq(friends.projectId, PROJECT_ID),
          or(
            and(eq(friends.userId, viewerId), eq(friends.friendId, targetUserId)),
            and(eq(friends.userId, targetUserId), eq(friends.friendId, viewerId))
          )
        )
      );

    await tx
      .delete(friendRequests)
      .where(
        and(
          eq(friendRequests.projectId, PROJECT_ID),
          or(
            and(
              eq(friendRequests.fromUserId, viewerId),
              eq(friendRequests.toUserId, targetUserId)
            ),
            and(
              eq(friendRequests.fromUserId, targetUserId),
              eq(friendRequests.toUserId, viewerId)
            )
          )
        )
      );
  });
}

