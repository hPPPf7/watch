// 月曆格的「車道」排版：連續日期看同一部作品時，卡片必須在每一天落在同一個
// 垂直位置，相鄰的日格才能靠負邊界把框接成一條 bar。
//
// 連續判斷是「跨整個月曆格」的：週六到週日在畫面上會斷行，但那只是換行，
// 不是兩段獨立的紀錄，所以斷行處兩端仍標記為相連（方角 + 貼齊格線邊緣）。
// 車道分配則必須以「一週」為單位，因為車道是該列的垂直位置。

export type LaneCard = {
  groupKey: string;
};

export type CalendarLaneSlot<T> = {
  card: T;
  continuesLeft: boolean;
  continuesRight: boolean;
};

type WeekSegment<T> = {
  startCol: number;
  endCol: number;
  cardByCol: Map<number, T>;
  // 該段落在這一列之外還有延續（上一列的結尾 / 下一列的開頭）
  openLeft: boolean;
  openRight: boolean;
  order: number;
};

const assignLanes = <T>(
  columnCount: number,
  segments: Array<WeekSegment<T>>,
): Array<Array<CalendarLaneSlot<T> | null>> => {
  // 長段落先占低車道，單日卡片才不會卡在中間把長 bar 擠到很下面。
  const ordered = segments.slice().sort((a, b) => {
    const spanA = a.endCol - a.startCol;
    const spanB = b.endCol - b.startCol;
    if (spanA !== spanB) return spanB - spanA;
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    return a.order - b.order;
  });

  const occupied = Array.from({ length: columnCount }, () => new Set<number>());
  const slots: Array<Array<CalendarLaneSlot<T> | null>> = Array.from(
    { length: columnCount },
    () => [],
  );

  ordered.forEach((segment) => {
    let lane = 0;
    for (;;) {
      let isFree = true;
      for (let col = segment.startCol; col <= segment.endCol; col += 1) {
        if (occupied[col].has(lane)) {
          isFree = false;
          break;
        }
      }
      if (isFree) break;
      lane += 1;
    }

    for (let col = segment.startCol; col <= segment.endCol; col += 1) {
      occupied[col].add(lane);
      const card = segment.cardByCol.get(col);
      if (!card) continue;
      while (slots[col].length <= lane) slots[col].push(null);
      slots[col][lane] = {
        card,
        continuesLeft: col > segment.startCol || segment.openLeft,
        continuesRight: col < segment.endCol || segment.openRight,
      };
    }
  });

  return slots;
};

export type LaneBoundary = {
  /** 延續自可見範圍「之前」的 groupKey：首格的 bar 左端不收邊 */
  continuingBefore?: ReadonlySet<string>;
  /** 延續到可見範圍「之後」的 groupKey：末格的 bar 右端不收邊 */
  continuingAfter?: ReadonlySet<string>;
};

/**
 * @param weeks 每一週的日期 key（各 7 格，含相鄰月份補格）
 * @param boundary 可見範圍外一天的探針結果；沒給就把最外緣一律收成圓角
 * @returns 以日期 key 為索引的車道陣列；`null` 代表該車道在這天是空的，
 *          渲染時仍必須留下等高佔位，否則相鄰格的 bar 會錯開接不起來。
 */
export const buildLaneLayout = <T extends LaneCard>(
  weeks: string[][],
  cardsByDate: Record<string, T[]>,
  boundary: LaneBoundary = {},
): Record<string, Array<CalendarLaneSlot<T> | null>> => {
  // 先把整個月曆攤平成一維，連續判斷才能跨過週界。
  const weekStarts: number[] = [];
  let cursor = 0;
  weeks.forEach((week) => {
    weekStarts.push(cursor);
    cursor += week.length;
  });
  const flatDays = weeks.flat();

  const weekIndexOf = (globalIndex: number) => {
    for (let i = weekStarts.length - 1; i >= 0; i -= 1) {
      if (globalIndex >= weekStarts[i]) return i;
    }
    return 0;
  };

  const byGroup = new Map<string, Map<number, T>>();
  const groupOrder = new Map<string, number>();
  // 同一天出現兩張同 groupKey 的卡片（例如同一部片分成兩筆紀錄）無法併進同一段，
  // 拆出來各自當成單日段落處理。
  const extras: Array<{ globalIndex: number; card: T }> = [];
  let order = 0;

  flatDays.forEach((dayKey, globalIndex) => {
    (cardsByDate[dayKey] ?? []).forEach((card) => {
      let days = byGroup.get(card.groupKey);
      if (!days) {
        days = new Map();
        byGroup.set(card.groupKey, days);
        groupOrder.set(card.groupKey, order);
        order += 1;
      }
      if (days.has(globalIndex)) {
        extras.push({ globalIndex, card });
        return;
      }
      days.set(globalIndex, card);
    });
  });

  const segmentsByWeek: Array<Array<WeekSegment<T>>> = weeks.map(() => []);

  const lastIndex = flatDays.length - 1;

  // 把一段全域連續的紀錄切進它跨過的每一列，切點兩端維持「相連」。
  const pushRun = (
    days: Map<number, T>,
    groupKey: string,
    runStart: number,
    runEnd: number,
    segmentOrder: number,
  ) => {
    // 貼齊可見範圍最外緣、而且探針顯示外面還有的話，那一端同樣不收邊。
    const openBeforeGrid =
      runStart === 0 && Boolean(boundary.continuingBefore?.has(groupKey));
    const openAfterGrid =
      runEnd === lastIndex && Boolean(boundary.continuingAfter?.has(groupKey));

    let weekIndex = weekIndexOf(runStart);
    let segStart = runStart;
    while (segStart <= runEnd) {
      const weekStart = weekStarts[weekIndex];
      const weekEnd = weekStart + weeks[weekIndex].length - 1;
      const segEnd = Math.min(runEnd, weekEnd);

      const cardByCol = new Map<number, T>();
      for (let i = segStart; i <= segEnd; i += 1) {
        const card = days.get(i);
        if (card) cardByCol.set(i - weekStart, card);
      }

      segmentsByWeek[weekIndex].push({
        startCol: segStart - weekStart,
        endCol: segEnd - weekStart,
        cardByCol,
        openLeft: segStart > runStart || openBeforeGrid,
        openRight: segEnd < runEnd || openAfterGrid,
        order: segmentOrder,
      });

      segStart = segEnd + 1;
      weekIndex += 1;
    }
  };

  byGroup.forEach((days, groupKey) => {
    const sorted = Array.from(days.keys()).sort((a, b) => a - b);
    const segmentOrder = groupOrder.get(groupKey) ?? 0;
    let runStart = sorted[0];
    let prev = sorted[0];

    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i] === prev + 1) {
        prev = sorted[i];
        continue;
      }
      pushRun(days, groupKey, runStart, prev, segmentOrder);
      runStart = sorted[i];
      prev = sorted[i];
    }
    pushRun(days, groupKey, runStart, prev, segmentOrder);
  });

  extras.forEach((extra, index) => {
    const weekIndex = weekIndexOf(extra.globalIndex);
    const col = extra.globalIndex - weekStarts[weekIndex];
    segmentsByWeek[weekIndex].push({
      startCol: col,
      endCol: col,
      cardByCol: new Map([[col, extra.card]]),
      openLeft: false,
      openRight: false,
      order: order + index,
    });
  });

  const layout: Record<string, Array<CalendarLaneSlot<T> | null>> = {};
  weeks.forEach((dayKeys, weekIndex) => {
    const weekSlots = assignLanes(dayKeys.length, segmentsByWeek[weekIndex]);
    dayKeys.forEach((dayKey, col) => {
      layout[dayKey] = weekSlots[col];
    });
  });
  return layout;
};
