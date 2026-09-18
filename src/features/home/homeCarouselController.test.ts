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
  let secondRect = rect(1344, 192);
  vi.spyOn(stage, "getBoundingClientRect").mockImplementation(() => rect(0, stageWidth));
  vi.spyOn(el, "getBoundingClientRect").mockImplementation(() => rect(0, stageWidth));
  vi.spyOn(slides[0], "getBoundingClientRect").mockImplementation(() => firstRect);
  vi.spyOn(slides[1], "getBoundingClientRect").mockImplementation(() => secondRect);
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
  return { stage, el, slides, state, events, controller, savePosition, setStageWidth: (value: number) => { stageWidth = value; }, setFirstRect: (value: DOMRect) => { firstRect = value; }, setSecondRect: (value: DOMRect) => { secondRect = value; } };
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
    // The stable half-card width is owned by CSS, not moving slide rectangles.
    expect(right.style.width).toBe("");
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
    expect(f.stage.dataset.moving).toBe("false");
    expect(right.hasAttribute("aria-disabled")).toBe(false);
    expect(f.stage.querySelector<HTMLButtonElement>("[data-home-prev]")!.hidden).toBe(false);
    vi.advanceTimersByTime(100);
    expect(vi.getTimerCount()).toBe(0);
    f.controller.destroy();
  });
  it.each([-1, 1] as const)("keeps both arrows stable as multiple card edges and gaps pass during %i navigation", direction => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const f = fixture();
    const previous = f.stage.querySelector<HTMLButtonElement>("[data-home-prev]")!;
    const next = f.stage.querySelector<HTMLButtonElement>("[data-home-next]")!;
    expect(previous.hidden).toBe(true);
    expect(next.hidden).toBe(false);
    f.setFirstRect(rect(-96, 192));
    f.controller.move(direction);
    expect(f.state.slideTo).toHaveBeenCalledWith(12 + direction * 6, 460);
    expect(previous.hidden).toBe(false);
    const arrows = [previous, next];
    const appearance = () => arrows.map(button => ({
      width: button.style.width,
      opacity: button.style.opacity,
      pointerEvents: button.style.pointerEvents,
      hidden: button.hidden,
    }));
    const settledAppearance = appearance();
    const focusedArrow = direction < 0 ? previous : next;
    focusedArrow.focus();
    const open = vi.fn();
    const card = f.slides[0].querySelector("button")!;
    card.addEventListener("click", open);
    f.state.animating = true;
    f.events.get("transitionStart")!();
    expect(f.stage.dataset.moving).toBe("true");
    expect(arrows.every(button => button.getAttribute("aria-disabled") === "true")).toBe(true);
    // Different partial widths and real gaps recur once for every passing card.
    const positions = [
      [-168, 1404], [12, 1224], [-24, 1260], [-180, 1440], [0, 1248], [-96, 1344],
    ];
    for (const [left, right] of direction > 0 ? positions : [...positions].reverse()) {
      f.setFirstRect(rect(left, 192));
      f.setSecondRect(rect(right, 192));
      vi.advanceTimersByTime(16);
      expect(appearance()).toEqual(settledAppearance);
      expect(document.activeElement).toBe(focusedArrow);
      expect(f.slides[0].inert).toBe(left < 0);
      // Even a briefly complete card must not open while the page is moving.
      card.click();
      expect(open).not.toHaveBeenCalled();
    }
    f.setFirstRect(rect(-96, 192));
    f.setSecondRect(rect(1344, 192));
    f.state.animating = false;
    f.events.get("transitionEnd")!();
    vi.advanceTimersByTime(16);
    expect(appearance()).toEqual(settledAppearance);
    expect(f.stage.dataset.moving).toBe("false");
    expect(arrows.every(button => !button.hasAttribute("aria-disabled"))).toBe(true);
    expect(f.slides.every(slide => slide.inert)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    card.click();
    expect(open).not.toHaveBeenCalled();
    f.controller.destroy();
  });
  it.each(["track", "widths"] as const)("reveals arrows only after both animations end when %s finishes first", async first => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const f = fixture();
    const finishWidths: (() => void)[] = [];
    for (const slide of f.slides) {
      Object.defineProperty(slide, "animate", { value: vi.fn(() => ({
        finished: new Promise<void>(resolve => finishWidths.push(resolve)),
        cancel: vi.fn(),
      })) });
    }
    f.state.slideTo.mockImplementation(() => {
      // Matches Swiper's ordering: the event precedes its animating flag.
      f.events.get("transitionStart")!();
      expect(f.stage.dataset.moving).toBe("true");
      f.state.animating = true;
    });
    const right = f.stage.querySelector<HTMLButtonElement>("[data-home-next]")!;
    right.focus();
    f.controller.move(1);
    expect(finishWidths).toHaveLength(2);
    expect(f.stage.dataset.moving).toBe("true");
    expect(right.getAttribute("aria-disabled")).toBe("true");
    expect(right.disabled).toBe(false);
    const endTrack = () => { f.state.animating = false; f.events.get("transitionEnd")!(); };
    const endWidths = async () => {
      finishWidths.forEach(finish => finish());
      await Promise.resolve();
      await Promise.resolve();
    };
    if (first === "track") endTrack();
    else await endWidths();
    vi.advanceTimersByTime(32);
    expect(f.stage.dataset.moving).toBe("true");
    expect(document.activeElement).toBe(right);
    f.controller.move(-1);
    expect(f.state.slideTo).toHaveBeenCalledTimes(1);
    if (first === "track") await endWidths();
    else endTrack();
    vi.advanceTimersByTime(32);
    expect(f.stage.dataset.moving).toBe("false");
    expect(right.hasAttribute("aria-disabled")).toBe(false);
    expect(document.activeElement).toBe(right);
    expect(vi.getTimerCount()).toBe(0);
    f.controller.destroy();
  });
  it.each(["keyboard", "wheel"] as const)("hides settled-layout arrows during %s navigation and restores them at rest", source => {
    const f = fixture(1440, { started: true, index: 0 });
    f.state.slideTo.mockImplementation(() => {
      f.events.get("transitionStart")!();
      f.state.animating = true;
    });
    if (source === "keyboard") f.el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    else f.stage.dispatchEvent(new WheelEvent("wheel", { deltaX: 40, deltaY: 0, cancelable: true }));
    expect(f.state.slideTo).toHaveBeenCalledTimes(1);
    expect(f.stage.dataset.moving).toBe("true");
    f.state.animating = false;
    f.events.get("transitionEnd")!();
    vi.advanceTimersByTime(32);
    expect(f.stage.dataset.moving).toBe("false");
    expect(vi.getTimerCount()).toBe(0);
    f.controller.destroy();
  });
  it("keeps arrows hidden throughout dragging and the release transition without idle animation polling", () => {
    const f = fixture(1440, { started: true, index: 0 });
    f.state.touchEventsData.isTouched = true;
    f.events.get("sliderFirstMove")!();
    expect(f.stage.dataset.moving).toBe("true");
    vi.advanceTimersByTime(32);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.stage.dataset.moving).toBe("true");
    f.controller.move(1);
    expect(f.state.slideTo).not.toHaveBeenCalled();
    f.events.get("touchEnd")!();
    f.state.touchEventsData.isTouched = false;
    f.events.get("transitionStart")!();
    f.state.animating = true;
    vi.advanceTimersByTime(32);
    expect(f.stage.dataset.moving).toBe("true");
    f.state.animating = false;
    f.events.get("transitionEnd")!();
    vi.advanceTimersByTime(32);
    expect(f.stage.dataset.moving).toBe("false");
    expect(vi.getTimerCount()).toBe(0);
    f.controller.destroy();
  });
  it("restores arrows after a drag released without a transition", () => {
    const f = fixture(1440, { started: true, index: 0 });
    f.state.touchEventsData.isTouched = true;
    f.events.get("sliderFirstMove")!();
    expect(f.stage.dataset.moving).toBe("true");
    f.events.get("touchEnd")!();
    f.state.touchEventsData.isTouched = false;
    vi.advanceTimersByTime(32);
    expect(f.stage.dataset.moving).toBe("false");
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
    expect(f.stage.dataset.moving).toBe("false");
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
