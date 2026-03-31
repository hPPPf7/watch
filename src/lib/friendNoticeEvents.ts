export const FRIEND_NOTICE_REFRESH_EVENT = "friend-notice:refresh";
export const FRIEND_GRAPH_REFRESH_EVENT = "friend-graph:refresh";

let friendGraphRevision = 0;

const bumpFriendGraphRevision = () => {
  friendGraphRevision += 1;
};

export const getFriendGraphRevision = () => friendGraphRevision;

export const dispatchFriendNoticeRefresh = () => {
  if (typeof window === "undefined") return;
  bumpFriendGraphRevision();
  window.dispatchEvent(new Event(FRIEND_NOTICE_REFRESH_EVENT));
  window.dispatchEvent(new Event(FRIEND_GRAPH_REFRESH_EVENT));
};

export const dispatchFriendGraphRefresh = () => {
  if (typeof window === "undefined") return;
  bumpFriendGraphRevision();
  window.dispatchEvent(new Event(FRIEND_GRAPH_REFRESH_EVENT));
};
