"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { formatLocalDateKey, parseDateOnlyKeyToLocalDate } from "@/lib/calendarDate";
import { buildLaneLayout, type LaneBoundary } from "@/lib/calendarLanes";
import styles from "./CalendarMonthView.module.css";

const WEEK_DAYS = ["日", "一", "二", "三", "四", "五", "六"];
const TYPE_LABELS = { movie: "電影", tv: "影集", anime: "動畫" };
const CELL_PADDING = 12;
const BAR_EDGE_GAP = 5;
const BAR_TEXT_GAP = 9;

export type CalendarMonthCard = {
  id: string;
  groupKey: string;
  title: string;
  detail: string;
  tone: "movie" | "tv" | "anime";
  participants: Array<{
    id: string;
    name: string;
    avatarUrl: string | null;
    isOwner: boolean;
  }>;
};

type CalendarMonthViewProps = {
  weeks: Array<Array<{ date: Date; inMonth: boolean }>>;
  cardsByDate: Record<string, CalendarMonthCard[]>;
  boundary: LaneBoundary;
  todayKey: string;
  toolbarRef: RefObject<HTMLDivElement | null>;
  escapeDisabled: boolean;
};

type PendingPosition = {
  dateKey: string;
  top: number;
  opening: boolean;
};

const cardTitle = (card: CalendarMonthCard) =>
  card.title.trim() || card.detail || "片名待更新";

export function CalendarParticipants({
  participants,
}: {
  participants: CalendarMonthCard["participants"];
}) {
  if (participants.length === 0) return null;
  return (
    <div className={styles.companions}>
      <span>和</span>
      {participants.map((person) => (
        <span key={person.id} className={`${styles.person} ${person.isOwner ? styles.owner : ""}`}>
          <span className={styles.avatar} aria-hidden="true">
            {person.avatarUrl ? <Image src={person.avatarUrl} alt="" fill sizes="20px" className={styles.avatarImage} /> : Array.from(person.name.trim())[0] || "友"}
          </span>
          <span>{person.name}</span>
        </span>
      ))}
      <span>一起看</span>
    </div>
  );
}

export default function CalendarMonthView({
  weeks,
  cardsByDate,
  boundary,
  todayKey,
  toolbarRef,
  escapeDisabled,
}: CalendarMonthViewProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dayRefs = useRef(new Map<string, HTMLElement>());
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingPositionRef = useRef<PendingPosition | null>(null);
  const restoreAnchorRef = useRef<(() => void) | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const panelId = useId();
  const headingId = useId();
  const laneLayout = buildLaneLayout(
    weeks.map((week) => week.map((day) => formatLocalDateKey(day.date))),
    cardsByDate,
    boundary,
  );

  const releaseScrollAnchor = useCallback(() => {
    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }
    restoreAnchorRef.current?.();
    restoreAnchorRef.current = null;
  }, []);

  const changePanel = useCallback(
    (dateKey: string, opening: boolean) => {
      if (opening && selectedDate === dateKey) {
        closeRef.current?.focus({ preventScroll: true });
        return;
      }
      releaseScrollAnchor();
      const day = dayRefs.current.get(dateKey);
      if (day) {
        pendingPositionRef.current = {
          dateKey,
          top: day.getBoundingClientRect().top,
          opening,
        };
      }
      // Opening changes the grid width and all wrapped lane heights. Temporarily
      // suspend native anchoring so it cannot apply a second scroll correction.
      const documentStyle = document.documentElement.style;
      const previous = documentStyle.getPropertyValue("overflow-anchor");
      const priority = documentStyle.getPropertyPriority("overflow-anchor");
      documentStyle.setProperty("overflow-anchor", "none");
      restoreAnchorRef.current = () => {
        if (previous) documentStyle.setProperty("overflow-anchor", previous, priority);
        else documentStyle.removeProperty("overflow-anchor");
      };
      setSelectedDate(opening ? dateKey : null);
    },
    [releaseScrollAnchor, selectedDate],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    const toolbar = toolbarRef.current;
    if (!root || !toolbar) return;
    let previousHeight = -1;
    const updateHeight = () => {
      const height = toolbar.getBoundingClientRect().height;
      if (height === previousHeight) return;
      previousHeight = height;
      root.style.setProperty("--calendar-toolbar-height", `${height}px`);
    };
    updateHeight();
    // Only observe the toolbar; changing a sidebar style cannot resize this
    // target and retrigger a measurement loop.
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateHeight);
    observer?.observe(toolbar);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [toolbarRef]);

  useLayoutEffect(() => {
    const pending = pendingPositionRef.current;
    if (!pending) return;
    pendingPositionRef.current = null;
    // Reading after React's commit also resolves subgrid's intrinsic lane rows.
    const day = dayRefs.current.get(pending.dateKey);
    if (day) {
      const offset = day.getBoundingClientRect().top - pending.top;
      if (offset !== 0) window.scrollBy({ top: offset, behavior: "instant" });
    }
    const focusTarget = pending.opening
      ? closeRef.current
      : buttonRefs.current.get(pending.dateKey);
    focusTarget?.focus({ preventScroll: true });
    // Keep native anchoring disabled through the paint that changes widths.
    restoreFrameRef.current = window.requestAnimationFrame(() => {
      restoreFrameRef.current = window.requestAnimationFrame(releaseScrollAnchor);
    });
  }, [selectedDate, releaseScrollAnchor]);

  useEffect(() => releaseScrollAnchor, [releaseScrollAnchor]);

  useEffect(() => {
    if (!selectedDate || escapeDisabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      changePanel(selectedDate, false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [changePanel, escapeDisabled, selectedDate]);

  const selectedDay = selectedDate ? parseDateOnlyKeyToLocalDate(selectedDate) : null;
  const selectedCards = selectedDate ? cardsByDate[selectedDate] ?? [] : [];

  return (
    <div ref={rootRef} className={`-mx-8 flex ${styles.layout}`} data-calendar-month>
      <div className={styles.calendar}>
        <div className={styles.weekdays} aria-hidden="true">
          {WEEK_DAYS.map((day) => <span key={day}>週{day}</span>)}
        </div>
        {weeks.map((week) => {
          const weekKeys = week.map((day) => formatLocalDateKey(day.date));
          const laneCount = Math.max(0, ...weekKeys.map((key) => laneLayout[key]?.length ?? 0));
          const weekStyle: CSSProperties = {
            gridTemplateRows: [
              "33px",
              ...Array.from({ length: laneCount }, () => "minmax(36px, max-content)"),
              "minmax(12px, 1fr)",
            ].join(" "),
          };
          return (
            <div key={weekKeys[0]} className={styles.week} style={weekStyle} data-calendar-week>
              {week.map((day, column) => {
                const dateKey = formatLocalDateKey(day.date);
                const cards = cardsByDate[dateKey] ?? [];
                const slots = laneLayout[dateKey] ?? [];
                const isToday = dateKey === todayKey;
                const isSelected = dateKey === selectedDate;
                return (
                  <section
                    key={dateKey}
                    ref={(element) => {
                      if (element) dayRefs.current.set(dateKey, element);
                      else dayRefs.current.delete(dateKey);
                    }}
                    data-calendar-day={dateKey}
                    className={[
                      styles.day,
                      !day.inMonth ? styles.outside : "",
                      isToday ? styles.today : "",
                      isSelected ? styles.selected : "",
                    ].join(" ")}
                    style={{ gridColumn: column + 1, gridRow: "1 / -1" }}
                  >
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) buttonRefs.current.set(dateKey, element);
                        else buttonRefs.current.delete(dateKey);
                      }}
                      className={styles.dayButton}
                      aria-label={`查看 ${day.date.getMonth() + 1} 月 ${day.date.getDate()} 日的 ${cards.length} 筆紀錄`}
                      aria-pressed={isSelected}
                      aria-expanded={isSelected}
                      aria-controls={isSelected ? panelId : undefined}
                      onClick={() => changePanel(dateKey, true)}
                    />
                    <div className={styles.dateHead} style={{ gridRow: 1 }}>
                      <time dateTime={dateKey} className={styles.date} aria-current={isToday ? "date" : undefined}>
                        {day.date.getDate()}
                      </time>
                      {isToday ? <span className={styles.todayLabel}>今天</span> : cards.length > 0 ? <span className={styles.dayCount}>{cards.length} 筆</span> : null}
                    </div>
                    {Array.from({ length: laneCount }, (_, lane) => {
                      const slot = slots[lane];
                      if (!slot) {
                        return <div key={`empty-${lane}`} className={styles.spacer} style={{ gridRow: lane + 2 }} data-calendar-lane={lane} aria-hidden="true" />;
                      }
                      const { card, continuesLeft, continuesRight } = slot;
                      const marginLeft = continuesLeft
                        ? -(CELL_PADDING + (column === 0 ? 0 : 1))
                        : -(CELL_PADDING - BAR_EDGE_GAP);
                      const marginRight = continuesRight ? -CELL_PADDING : -(CELL_PADDING - BAR_EDGE_GAP);
                      const barStyle: CSSProperties = {
                        gridRow: lane + 2,
                        marginLeft,
                        marginRight,
                        paddingLeft: BAR_EDGE_GAP + BAR_TEXT_GAP - (CELL_PADDING + marginLeft),
                        paddingRight: BAR_EDGE_GAP + BAR_TEXT_GAP - (CELL_PADDING + marginRight),
                        borderTopLeftRadius: continuesLeft ? 0 : 7,
                        borderBottomLeftRadius: continuesLeft ? 0 : 7,
                        borderTopRightRadius: continuesRight ? 0 : 7,
                        borderBottomRightRadius: continuesRight ? 0 : 7,
                      };
                      return (
                        <div key={card.id} className={`${styles.bar} ${styles[card.tone]}${continuesLeft ? "" : ` ${styles.barStart}`}${continuesRight ? "" : ` ${styles.barEnd}`}`} style={barStyle} data-calendar-record={card.id} data-calendar-lane={lane}>
                          <span className={styles.title}>{cardTitle(card)}</span>
                          {card.title.trim() && card.detail ? <span className={styles.episode}>{card.detail}</span> : null}
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          );
        })}
      </div>
      {selectedDate && selectedDay ? (
        <aside id={panelId} className={styles.panel} aria-label="當日完整紀錄">
          <div className={styles.panelDate}>
            <h2 id={headingId}>{selectedDay.getMonth() + 1} 月 {selectedDay.getDate()} 日</h2>
            <div className={styles.panelActions}>
              <small>週{WEEK_DAYS[selectedDay.getDay()]}</small>
              <button ref={closeRef} type="button" className={styles.closeButton} aria-label="關閉當日明細" title="關閉當日明細（Esc）" onClick={() => changePanel(selectedDate, false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>
          </div>
          <p className={styles.panelIntro}>{selectedCards.length} 筆觀看紀錄</p>
          <div key={selectedDate} className={styles.panelRecords} tabIndex={0} role="region" aria-labelledby={headingId}>
            {selectedCards.length > 0 ? selectedCards.map((card) => (
              <article key={card.id} className={`${styles.detailRow} ${styles[card.tone]}`} data-calendar-detail-record={card.id}>
                <div className={styles.type}><i aria-hidden="true" />{TYPE_LABELS[card.tone]}</div>
                <h3>{cardTitle(card)}</h3>
                {card.title.trim() && card.detail ? <p className={styles.detailEpisodes}>{card.detail}</p> : null}
                <CalendarParticipants participants={card.participants} />
              </article>
            )) : <p className={styles.emptyDay}>這天還沒有觀看紀錄。</p>}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
