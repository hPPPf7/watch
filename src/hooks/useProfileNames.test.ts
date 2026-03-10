import { describe, expect, it } from "vitest";
import { mergeProfileNameMap } from "@/hooks/useProfileNames";

describe("mergeProfileNameMap", () => {
  it("會移除這次請求中已不可見的舊 profile", () => {
    const previous = {
      keep: { nickname: "保留", avatarUrl: "keep.png" },
      removed: { nickname: "舊好友", avatarUrl: "old.png" },
    };

    const next = mergeProfileNameMap(previous, ["removed"], []);

    expect(next).toEqual({
      keep: { nickname: "保留", avatarUrl: "keep.png" },
    });
  });

  it("會用新回傳 rows 覆蓋這次請求內仍可見的 profile", () => {
    const previous = {
      friend: { nickname: "舊暱稱", avatarUrl: "old.png" },
    };

    const next = mergeProfileNameMap(previous, ["friend"], [
      { id: "friend", nickname: "新暱稱", avatar_url: "new.png" },
    ]);

    expect(next).toEqual({
      friend: { nickname: "新暱稱", avatarUrl: "new.png" },
    });
  });
});
