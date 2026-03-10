export const MAX_PROFILE_BULK_IDS = 200;

export function chunkProfileIds(ids: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += MAX_PROFILE_BULK_IDS) {
    chunks.push(ids.slice(index, index + MAX_PROFILE_BULK_IDS));
  }
  return chunks;
}
