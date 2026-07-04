import { describe, expect, it } from "vitest";
import {
  buildUnacknowledgedAlertMap,
  normalizeAlertedEpisodeDisplayState,
  preserveActiveEpisodeAlertIdentity,
  reconcileEpisodeAlertWatchCount,
  resolveFirstReleaseAlertState,
} from "./episodeDisplayState";

describe("reconcileEpisodeAlertWatchCount", () => {
  it("觀看數增加時清除提示並推進通知基準", () => {
    expect(
      reconcileEpisodeAlertWatchCount({
        alertActive: true,
        alertNotifiedCount: 2,
        watchedCount: 3,
      }),
    ).toEqual({
      alertActive: false,
      alertNotifiedCount: 3,
      watchCountAdvanced: true,
    });
  });

  it("修復提示已關閉但通知基準落後的舊狀態", () => {
    expect(
      reconcileEpisodeAlertWatchCount({
        alertActive: false,
        alertNotifiedCount: 2,
        watchedCount: 3,
      }),
    ).toEqual({
      alertActive: false,
      alertNotifiedCount: 3,
      watchCountAdvanced: true,
    });
  });

  it("觀看數沒有增加時保留提示狀態", () => {
    expect(
      reconcileEpisodeAlertWatchCount({
        alertActive: true,
        alertNotifiedCount: 3,
        watchedCount: 3,
      }),
    ).toEqual({
      alertActive: true,
      alertNotifiedCount: 3,
      watchCountAdvanced: false,
    });
  });
});

describe("normalizeAlertedEpisodeDisplayState", () => {
  it("已完成作品不會顯示殘留的新集數提示", () => {
    const result = normalizeAlertedEpisodeDisplayState({
      alertMap: { 10: true },
      statusMap: { 10: "已看完目前已播出集數" },
      progressMap: { 10: "completed" },
    });

    expect(result.alertMap[10]).toBe(false);
    expect(result.statusMap[10]).toBe("已看完目前已播出集數");
    expect(result.progressMap[10]).toBe("completed");
  });

  it("沒有新集數提示時保留已完成狀態", () => {
    const result = normalizeAlertedEpisodeDisplayState({
      alertMap: { 10: false },
      statusMap: { 10: "已看完目前已播出集數" },
      progressMap: { 10: "completed" },
    });

    expect(result.statusMap[10]).toBe("已看完目前已播出集數");
    expect(result.progressMap[10]).toBe("completed");
  });

  it("尚未完成作品會保留新集數提示", () => {
    const result = normalizeAlertedEpisodeDisplayState({
      alertMap: { 10: true },
      statusMap: { 10: "下一集：S1E3" },
      progressMap: { 10: "watching" },
    });

    expect(result.alertMap[10]).toBe(true);
    expect(result.statusMap[10]).toBe("下一集：S1E3");
    expect(result.progressMap[10]).toBe("watching");
  });

  it("已完成狀態尚未重算時仍保留具 generation 的未讀提示", () => {
    const result = normalizeAlertedEpisodeDisplayState({
      alertMap: { 10: false },
      statusMap: { 10: "已看完目前已播出集數" },
      progressMap: { 10: "completed" },
      authoritativeAlertMap: { 10: true },
    });

    expect(result.alertMap[10]).toBe(true);
  });
});

describe("buildUnacknowledgedAlertMap", () => {
  it("只標記具 generation 且尚未 acknowledged 的有效提醒", () => {
    expect(
      buildUnacknowledgedAlertMap({
        10: {
          alert_active: true,
          alert_generation: "episode:1:3",
          alert_acknowledged_generation: null,
        },
        20: {
          alert_active: true,
          alert_generation: "episode:2:4",
          alert_acknowledged_generation: "episode:2:4",
        },
        30: {
          alert_active: true,
          alert_generation: null,
          alert_acknowledged_generation: null,
        },
        40: {
          alert_active: true,
          alert_notified_watch_count: 3,
          last_watched_count: 3,
          alert_started_at: "2026-07-03T12:00:00.000Z",
          alert_generation: null,
          alert_acknowledged_generation: null,
          next_episode_season: 1,
          next_episode_number: 4,
        },
        50: {
          alert_active: true,
          alert_notified_watch_count: 3,
          last_watched_count: 4,
          alert_started_at: "2026-07-03T12:00:00.000Z",
          alert_generation: null,
          alert_acknowledged_generation: null,
          next_episode_season: 1,
          next_episode_number: 4,
        },
      }),
    ).toEqual({ 10: true, 40: true });
  });
});

describe("preserveActiveEpisodeAlertIdentity", () => {
  const current = {
    alert_active: true,
    alert_started_at: "2026-07-04T00:00:00.000Z",
    alert_generation: null,
    alert_acknowledged_generation: null,
    next_episode_season: 1,
    next_episode_number: 13,
  };

  it("桌面同步回傳不完整的有效提醒時保留目前識別欄位", () => {
    expect(
      preserveActiveEpisodeAlertIdentity(
        {
          alert_active: true,
          alert_started_at: "2026-07-04T00:00:00.000Z",
          alert_generation: null,
          alert_acknowledged_generation: null,
          next_episode_season: null,
          next_episode_number: null,
        },
        current,
      ),
    ).toMatchObject({
      alert_active: true,
      alert_started_at: "2026-07-04T00:00:00.000Z",
      next_episode_season: 1,
      next_episode_number: 13,
    });
  });

  it("已失效的提醒不沿用舊識別欄位", () => {
    const incoming = {
      alert_active: false,
      alert_started_at: null,
      alert_generation: null,
      alert_acknowledged_generation: null,
      next_episode_season: null,
      next_episode_number: null,
    };

    expect(
      preserveActiveEpisodeAlertIdentity(incoming, current),
    ).toEqual(incoming);
  });

  it("完整的新提醒不會被舊資料覆蓋", () => {
    const incoming = {
      alert_active: true,
      alert_started_at: "2026-07-05T00:00:00.000Z",
      alert_generation: "episode:2:1",
      alert_acknowledged_generation: null,
      next_episode_season: 2,
      next_episode_number: 1,
    };

    expect(
      preserveActiveEpisodeAlertIdentity(incoming, current),
    ).toEqual(incoming);
  });
});

describe("resolveFirstReleaseAlertState", () => {
  it("先觀察到尚未播出的作品，播出日到達後會啟用提醒", () => {
    expect(
      resolveFirstReleaseAlertState({
        releaseDate: "2026-07-03",
        today: "2026-07-03",
        watchedCount: 0,
        currentState: "pending",
        previousCheckedAt: "2026-07-02T12:00:00.000Z",
      }),
    ).toBe("active");
  });

  it("播出後才加入清單的作品不會補發首播提醒", () => {
    expect(
      resolveFirstReleaseAlertState({
        releaseDate: "2026-07-01",
        addedAt: "2026-07-02T08:00:00.000Z",
        today: "2026-07-03",
        watchedCount: 0,
        currentState: null,
        previousCheckedAt: null,
      }),
    ).toBe("acknowledged");
  });

  it("播出前加入但從未建立狀態的作品仍會啟用提醒", () => {
    expect(
      resolveFirstReleaseAlertState({
        releaseDate: "2026-07-03",
        addedAt: "2026-06-20T08:00:00.000Z",
        today: "2026-07-04",
        watchedCount: 0,
        currentState: null,
        previousCheckedAt: null,
      }),
    ).toBe("active");
  });

  it("已讀的首播提醒不會再次啟用", () => {
    expect(
      resolveFirstReleaseAlertState({
        releaseDate: "2026-07-01",
        today: "2026-07-03",
        watchedCount: 0,
        currentState: "acknowledged",
        previousCheckedAt: "2026-07-01T00:00:00.000Z",
      }),
    ).toBe("acknowledged");
  });
});
