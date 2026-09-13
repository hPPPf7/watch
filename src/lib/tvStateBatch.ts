// Keep request/transaction work bounded, including duplicate raw entries.
export const MAX_TV_STATE_BATCH_SIZE = 200;

export function takeTvStateBatch<T>(states: T[]) {
  return { batch: states.slice(0, MAX_TV_STATE_BATCH_SIZE), hasMore: states.length > MAX_TV_STATE_BATCH_SIZE };
}
