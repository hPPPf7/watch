"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import useModalFocus from "@/hooks/useModalFocus";
import styles from "./WatchRecordEditor.module.css";

export type WatchRecordEditorFriend = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type WatchRecordEditorProps = {
  inputId: string;
  title: string;
  subtitle?: string;
  date: string;
  today: string;
  lastDate?: string;
  friends: WatchRecordEditorFriend[];
  selectedFriendIds: string[];
  friendsLoading: boolean;
  friendsReady: boolean;
  disabled: boolean;
  busy: boolean;
  retryLoading?: boolean;
  notice?: string;
  noticeTone?: "error" | "success";
  onDateChange: (date: string) => void;
  onFriendsChange: (ids: string[]) => void;
  onDateFocus: () => void;
  onDateBlur: () => void;
  onDismiss: () => void;
  onSubmit: () => void;
  onEscape: () => void;
  onRetry?: () => void;
};

function previousDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return "";
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

/** Drafts and requests belong to DetailModal; only the local search lives here. */
export default function WatchRecordEditor({
  inputId,
  title,
  subtitle,
  date,
  today,
  lastDate,
  friends,
  selectedFriendIds,
  friendsLoading,
  friendsReady,
  disabled,
  busy,
  retryLoading = false,
  notice,
  noticeTone = "error",
  onDateChange,
  onFriendsChange,
  onDateFocus,
  onDateBlur,
  onDismiss,
  onSubmit,
  onEscape,
  onRetry,
}: WatchRecordEditorProps) {
  const panelRef = useRef<HTMLFormElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  useModalFocus(panelRef, true, onEscape);

  const unavailable = disabled || busy;
  const retryPending = retryLoading || friendsLoading;
  const selected = new Set(selectedFriendIds);
  const selectionCount = selected.size;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleFriends = friends.filter((friend) =>
    friend.name.toLocaleLowerCase().includes(normalizedQuery),
  );
  const selectedNames = friends
    .filter((friend) => selected.has(friend.id))
    .map((friend) => friend.name);
  const selectionSummary = selectionCount
    ? `已選 ${selectionCount} 位${selectedNames.length ? ` · ${selectedNames.join("、")}` : ""}`
    : "未選好友，只記錄自己";
  const saveSummary = `${date ? date.replaceAll("-", " / ") : "請選擇日期"} · ${selectionCount ? `與 ${selectionCount} 位好友一起觀看` : "自己觀看"}`;
  const shortcuts = [
    { label: "今天", value: today },
    { label: "昨天", value: previousDate(today) },
    ...(lastDate && lastDate <= today
      ? [{ label: `上次日期 · ${Number(lastDate.slice(5, 7))}/${Number(lastDate.slice(8, 10))}`, value: lastDate }]
      : []),
  ];
  const titleId = `${inputId}-editor-title`;
  const subtitleId = `${inputId}-editor-subtitle`;
  const friendsLabelId = `${inputId}-friends-label`;

  return (
    <div className={styles.layer} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={styles.backdrop}
        tabIndex={-1}
        aria-label="收起紀錄編輯"
        disabled={busy}
        onClick={onDismiss}
      />
      <form
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-busy={busy}
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          if (!unavailable) onSubmit();
        }}
      >
        <header className={styles.header}>
          <h2 id={titleId} title={title}>{title}</h2>
          {subtitle && <p id={subtitleId} title={subtitle}>{subtitle}</p>}
        </header>

        <div className={styles.body}>
          <section className={styles.dateSection}>
            <label className={styles.fieldTitle} htmlFor={inputId}>選擇日期</label>
            <input
              id={inputId}
              name={inputId}
              className={styles.dateInput}
              type="date"
              value={date}
              max={today}
              required
              disabled={unavailable}
              onFocus={onDateFocus}
              onBlur={onDateBlur}
              onChange={(event) => onDateChange(event.target.value)}
            />
            <div className={styles.quickDates}>
              {shortcuts.map((shortcut, index) => (
                <button
                  key={index}
                  type="button"
                  aria-pressed={date === shortcut.value}
                  title={index === 2 ? `自己上次填寫的日期：${shortcut.value}` : shortcut.value}
                  disabled={unavailable || !shortcut.value}
                  onClick={() => onDateChange(shortcut.value)}
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.friendSection} aria-labelledby={friendsLabelId}>
            <div className={styles.fieldTitle}>
              <span id={friendsLabelId}>一起觀看的好友</span>
              <small className="watch-loading" role={retryPending ? "status" : undefined}><span className="watch-spinner-slot" aria-hidden="true">{retryPending && <span className="watch-spinner" />}</span>{retryPending ? "載入中…" : "選填"}</small>
            </div>
            <div className={styles.search}>
              <input
                ref={searchRef}
                type="search"
                name={`${inputId}-friend-search`}
                value={query}
                autoComplete="off"
                placeholder="搜尋好友"
                aria-label="搜尋好友"
                disabled={busy}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Search and IME confirmation must never submit the record form.
                  if (event.key === "Enter") event.preventDefault();
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label="清除搜尋"
                  disabled={busy}
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus({ preventScroll: true });
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <div className={styles.friendList} aria-busy={friendsLoading}>
              {visibleFriends.map((friend) => (
                <label key={friend.id} className={styles.friend}>
                  <input
                    type="checkbox"
                    name={`${inputId}-share-friend`}
                    value={friend.id}
                    checked={selected.has(friend.id)}
                    disabled={unavailable || !friendsReady}
                    onChange={(event) => {
                      onFriendsChange(event.target.checked
                        ? [...selected, friend.id]
                        : selectedFriendIds.filter((id) => id !== friend.id));
                    }}
                  />
                  <span className={styles.avatar} aria-hidden="true">
                    {friend.avatarUrl ? (
                      <Image src={friend.avatarUrl} alt="" fill sizes="24px" className={styles.avatarImage} />
                    ) : friend.name.slice(0, 1)}
                  </span>
                  <span className={styles.friendName} title={friend.name}>{friend.name}</span>
                </label>
              ))}
              {visibleFriends.length === 0 && (
                <p className={styles.empty}>
                  {friends.length > 0
                    ? "找不到這位好友，試試其他名稱。"
                    : friendsLoading
                      ? "載入好友中…"
                      : friendsReady
                        ? "目前沒有好友，可以只記錄自己。"
                        : "暫時無法確認好友。"}
                </p>
              )}
            </div>
            <div className={styles.selection}>
              <span title={selectionSummary} role="status">{selectionSummary}</span>
              {selectionCount > 0 && (
                <button type="button" disabled={unavailable || !friendsReady} onClick={() => onFriendsChange([])}>
                  清除選擇
                </button>
              )}
            </div>
          </section>
        </div>

        {(notice || onRetry) && (
          <div className={styles.noticeArea} role="region" aria-label="觀看紀錄提示" tabIndex={0}>
            {notice && (
              <p className={noticeTone === "error" ? styles.error : styles.success} role={noticeTone === "error" ? "alert" : "status"}>
                {notice}
              </p>
            )}
            {onRetry && (
              <button className="watch-button watch-button--small" type="button" aria-label="重試清單狀態與好友" aria-busy={retryPending} disabled={busy || retryPending} onClick={onRetry}>
                重新載入
              </button>
            )}
          </div>
        )}
        <footer className={styles.footer}>
          <p className={styles.saveSummary} title={saveSummary}>{saveSummary}</p>
          <div className={styles.actions}>
            <button className="watch-button" type="button" disabled={busy} onClick={onDismiss}>取消</button>
            <button className={`watch-button watch-button--primary ${styles.submitButton}`} type="submit" disabled={unavailable}>
              {busy && <span className="watch-spinner" aria-hidden="true" />}{busy ? "處理中…" : "確認紀錄"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
