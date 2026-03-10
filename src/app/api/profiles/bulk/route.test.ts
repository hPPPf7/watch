import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

import { POST } from "@/app/api/profiles/bulk/route";

describe("POST /api/profiles/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("非法 UUID ids 會直接回 BAD_REQUEST", async () => {
    const response = await POST(
      new Request("http://localhost/api/profiles/bulk", {
        method: "POST",
        body: JSON.stringify({ ids: ["not-a-uuid"] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid ids",
    });
    expect(getDb).not.toHaveBeenCalled();
  });
});
