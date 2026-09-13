// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Swiper as SwiperType } from "swiper/types";
import { createHomeCarouselController } from "./homeCarouselController";

function rect(left: number, width: number) { return { left, right: left + width, width, top: 0, bottom: 360, height: 360, x: left, y: 0, toJSON() {} }; }
function fixture(initialWidth = 1440, initialPosition = { started: false, index: 0 }) {
  let stageWidth = initialWidth;
  const stage = document.createElement("div");
  stage.dataset.homeCarousel = "";
  stage.innerHTML = '<div tabindex="0"><div><div data-home-slide><button>完整卡片</button></div><div data-home-slide><button>半張卡片</button></div></div></div><button data-home-prev hidden>上頁</button><button data-home-next>下頁</button>';
  document.body.append(stage);
  const el = stage.firstElementChild as HTMLElement;
  const wrapper = el.firstElementChild as HTMLElement;
  const slides = Array.from(wrapper.children) as HTMLElement[];
  let firstRect = rect(40, 192);
  vi.spyOn(stage, "getBoundingClientRect").mockImplementation(() => rect(0, stageWidth));
  vi.spyOn(el, "getBoundingClientRect").mockImplementation(() => rect(0, stageWidth));
  vi.spyOn(slides[0], "getBoundingClientRect").mockImplementation(() => firstRect);
  vi.spyOn(slides[1], "getBoundingClientRect").mockImplementation(() => rect(1344, 192));
  const events = new Map<string, () => void>();
  const savePosition = vi.fn();
  const state = {
    el, wrapperEl: wrapper, slides, params: {}, originalParams: {}, activeIndex: 12, realIndex: 17,
    snapGrid: Array.from({ length: 50 }, (_, index) => index * 204), animating: false,
    allowClick: true, allowTouchMove: true, destroyed: false, initialized: true, touchEventsData: { isTouched: false },
    on: vi.fn((event: string, callback: () => void) => events.set(event, callback)),
    loopFix: vi.fn(), updateSlides: vi.fn(), setTransition: vi.fn(),
    slideTo: vi.fn(), slideToLoop: vi.fn(), update: vi.fn(),
  };
  const controller = createHomeCarouselController(state as unknown as SwiperType, {
    itemCount: 10, initialPosition, savePosition,
  });
  events.get("init")!();
  return { stage, el, slides, state, events, controller, savePosition, setStageWidth: (value: number) => { stageWidth = value; }, setFirstRect: (value: DOMRect) => { firstRect = value; } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("home carousel interaction guards", () => {
  it("allows a full card but blocks a partial card, including stale geometry between animation frames", () => {
    const f = fixture();
    const open = vi.fn();
    const first = f.slides[0].querySelector("button")!;
    const partial = f.slides[1].querySelector("button")!;
    first.addEventListener("click", open);
    partial.addEventListener("click", open);
    expect(f.slides[0].inert).toBe(false);
    expect(f.slides[1].inert).toBe(true);
    first.click(); partial.click();
    expect(open).toHaveBeenCalledTimes(1);
    f.setFirstRect(rect(-24, 192));
    first.click();
    expect(open).toHaveBeenCalledTimes(1);
    f.controller.destroy();
  });
  it("preserves keyboard access and only runs edge frames while something moves", () => {
    const f = fixture();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.stage.querySelector<HTMLButtonElement>("[data-home-prev]")!.hidden).toBe(true);
    const right = f.stage.querySelector<HTMLButtonElement>("[data-home-next]")!;
    expect(right.style.width).toBe("96px");
    f.slides[0].querySelector("button")!.focus();
    f.setFirstRect(rect(-24, 192));
    f.events.get("setTranslate")!();
    vi.advanceTimersByTime(100);
    expect(document.activeElement).toBe(f.el);
    expect(f.slides[0].getAttribute("aria-hidden")).toBe("true");
    expect(vi.getTimerCount()).toBe(0);
    f.controller.move(1);
    expect(f.state.slideTo).toHaveBeenCalledWith(18, 0);
    expect(f.stage.dataset.layout).toBe("balanced");
    expect(f.stage.querySelector<HTMLButtonElement>("[data-home-prev]")!.hidden).toBe(false);
    vi.advanceTimersByTime(100);
    expect(vi.getTimerCount()).toBe(0);
    f.controller.destroy();
  });
  it.each([0, 1440])("recovers a %i px mount after hidden-search resize without observing card height", initialWidth => {
    let notifyResize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const f = fixture(initialWidth);
    expect(parseFloat(f.stage.style.getPropertyValue("--home-card-width"))).toBeGreaterThan(1);
    const originalWidth = f.stage.style.getPropertyValue("--home-card-width");
    f.setStageWidth(0);
    notifyResize();
    f.events.get("beforeResize")!();
    expect(f.stage.style.getPropertyValue("--home-card-width")).toBe(originalWidth);
    f.setStageWidth(768);
    notifyResize();
    expect(f.state.update).toHaveBeenCalledTimes(1);
    if (initialWidth === 0) expect(f.state.slideToLoop).toHaveBeenCalledWith(0, 0, false);
    else expect(f.state.slideToLoop).not.toHaveBeenCalled();
    notifyResize();
    expect(f.state.update).toHaveBeenCalledTimes(1);
    f.controller.destroy();
    if (initialWidth === 0) expect(f.savePosition).toHaveBeenCalledWith({ started: false, index: 0 });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("stops canceled transitions while hidden and restores navigation (first drag: %s)", firstDrag => {
    let notifyResize = () => {};
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe() {}
      disconnect() {}
    });
    const f = fixture();
    if (firstDrag) f.events.get("sliderFirstMove")!();
    else f.controller.move(1);
    f.state.animating = true;
    f.events.get("transitionStart")!();
    f.events.get("touchEnd")!();
    f.state.wrapperEl.addEventListener("transitionend", () => f.events.get("transitionEnd")!());
    f.setStageWidth(0);
    notifyResize();
    expect(f.state.animating).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.mocked(f.slides[0].getBoundingClientRect).mockClear();
    f.events.get("setTranslate")!();
    f.events.get("transitionEnd")!();
    vi.advanceTimersByTime(1000);
    expect(f.slides[0].getBoundingClientRect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    f.state.slideTo.mockClear();
    f.controller.move(1);
    expect(f.state.slideTo).not.toHaveBeenCalled();
    f.setStageWidth(390);
    notifyResize();
    expect(f.stage.dataset.layout).toBe("balanced");
    expect(f.state.update).toHaveBeenCalled();
    f.controller.move(-1);
    expect(f.state.slideTo).toHaveBeenCalled();
    f.controller.destroy();
  });
  it("keeps a saved nonzero position through a hidden StrictMode cleanup", () => {
    const f = fixture(0, { started: true, index: 6 });
    expect(f.stage.dataset.layout).toBe("balanced");
    f.controller.destroy();
    expect(f.savePosition).toHaveBeenCalledWith({ started: true, index: 6 });
  });
  it("blocks details during navigation and cancels work on a source replacement", () => {
    const f = fixture();
    const open = vi.fn();
    f.slides[0].querySelector("button")!.addEventListener("click", open);
    f.state.animating = true;
    f.slides[0].querySelector("button")!.click();
    expect(open).not.toHaveBeenCalled();
    f.events.get("setTranslate")!();
    f.events.get("touchEnd")!();
    expect(vi.getTimerCount()).toBe(2);
    f.controller.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.savePosition).toHaveBeenCalledWith({ started: false, index: 7 });
    f.controller.move(1);
    expect(f.state.slideTo).not.toHaveBeenCalled();
  });
});
