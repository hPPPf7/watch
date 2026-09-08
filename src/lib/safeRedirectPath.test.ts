import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safeRedirectPath";
describe("登入返回路徑", () => {
  it.each(["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "https://evil.example", "javascript:alert(1)", null])("拒絕外站與控制字元：%s", value => expect(safeRedirectPath(value)).toBeNull());
  it("拒絕 URLSearchParams 解碼後的攻擊", () => expect(safeRedirectPath(new URLSearchParams("next=/%09/evil.example").get("next"))).toBeNull());
  it.each(["/", "/watchlist?mediaType=tv#progress", "/a/..//evil.example", "/search?q=%E4%B8%AD%E6%96%87"]) ("合法返回路徑保持同源：%s", value => {
    const safe = safeRedirectPath(value);
    expect(safe).toBe(value);
    expect(new URL(safe!, "https://watch.invalid").origin).toBe("https://watch.invalid");
  });
});
