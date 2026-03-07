export const FRIEND_NOTICE_REFRESH_EVENT = "friend-notice:refresh";

export const dispatchFriendNoticeRefresh = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FRIEND_NOTICE_REFRESH_EVENT));
};
