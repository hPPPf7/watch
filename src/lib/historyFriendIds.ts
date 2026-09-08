import { isUuidString } from "./uuid";
export const MAX_HISTORY_FRIEND_IDS = 100;
export function parseHistoryFriendIds(value: unknown):
  | { ok: true; ids: string[] | undefined }
  | { ok: false; message: string } {
  if (value === undefined) return { ok: true, ids: undefined };
  if (!Array.isArray(value)) return { ok: false, message: "好友名單格式錯誤。" };
  // 先限制原始長度，重複 ID 也不能繞過輸入上限。
  if (value.length > MAX_HISTORY_FRIEND_IDS) return { ok: false, message: "每次最多同步 100 位好友。" };
  if (value.some(id => typeof id !== "string" || !isUuidString(id))) return { ok: false, message: "好友名單格式錯誤。" };
  return { ok: true, ids: [...new Set(value.map(id => (id as string).toLowerCase()))] };
}
