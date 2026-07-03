import { describe, expect, it } from "vitest";
import {
  normalizeAlertedEpisodeDisplayState,
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
