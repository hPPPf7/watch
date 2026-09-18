import type { Swiper as SwiperType } from "swiper/types";
import { getHomeCarouselGeometry, isHomeCardFullyVisible, type HomeCarouselLayout } from "./homeCarouselGeometry";

// Swiper's loop/touch runtime methods are present in the installed core, but not
// all are exposed by its public TypeScript interface. Keep this dependency here.
type LoopSwiper = SwiperType & {
  loopFix(options: { direction: "next" | "prev" }): void;
  setTransition(duration: number): void;
  allowClick: boolean;
  initialized: boolean;
  touchEventsData: { isTouched: boolean };
};
export type HomeCarouselPosition = { started: boolean; index: number };

type ControllerOptions = {
  itemCount: number;
  initialPosition: HomeCarouselPosition;
  savePosition(position: HomeCarouselPosition): void;
};

export function createHomeCarouselController(instance: SwiperType, options: ControllerOptions) {
  const swiper = instance as LoopSwiper;
  const stage = swiper.el.closest<HTMLElement>("[data-home-carousel]")!;
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let started = options.initialPosition.started;
  let layout: HomeCarouselLayout = started ? "balanced" : "compact";
  let measuredWidth = stage.getBoundingClientRect().width;
  let wasHidden = measuredWidth <= 0;
  let needsInitialAlignment = wasHidden;
  let lastVisibleWidth = measuredWidth || document.documentElement.clientWidth || window.innerWidth;
  let geometry = getHomeCarouselGeometry(lastVisibleWidth, options.itemCount, layout);
  let disposed = false;
  let edgeFrame = 0;
  let touchFrame = 0;
  let alignmentFrame = 0;
  let layoutMoving = false;
  let touchMoving = false;
  let widthAnimations: Animation[] | null = null;
  let wheelTotal = 0;
  let lastWheel = 0;
  let resizeObserver: ResizeObserver | null = null;

  function applyGeometry() {
    measuredWidth = stage.getBoundingClientRect().width;
    if (measuredWidth > 0) lastVisibleWidth = measuredWidth;
    geometry = getHomeCarouselGeometry(lastVisibleWidth, options.itemCount, layout);
    stage.style.setProperty("--home-card-width", `${geometry.cardWidth}px`);
    stage.style.setProperty("--home-card-gap", `${geometry.gap}px`);
    stage.style.setProperty("--home-start-inset", `${geometry.inset}px`);
    stage.dataset.layout = layout;
    stage.dataset.started = String(started);
    stage.dataset.pageSize = String(geometry.pageSize);
    swiper.params.spaceBetween = geometry.gap;
    swiper.originalParams.spaceBetween = geometry.gap;
    swiper.params.loopAdditionalSlides = geometry.pageSize;
    swiper.originalParams.loopAdditionalSlides = geometry.pageSize;
  }
  function isAvailable() { return !disposed && !swiper.destroyed; }
  function syncArrows(moving = swiper.animating || layoutMoving || touchMoving) {
    if (!isAvailable()) return;
    stage.dataset.moving = String(moving);
    for (const side of ["prev", "next"]) {
      const button = stage.querySelector<HTMLButtonElement>(`[data-home-${side}]`);
      if (!button) continue;
      if (side === "prev") button.hidden = !started;
      // Keep focus and the half-card click shield while controls are invisible.
      if (moving) button.setAttribute("aria-disabled", "true");
      else button.removeAttribute("aria-disabled");
    }
  }
  function syncEdges() {
    if (!isAvailable() || wasHidden) return;
    const viewport = swiper.el.getBoundingClientRect();
    const measurements = swiper.slides.map(slide => ({ slide, rect: slide.getBoundingClientRect() }));
    for (const { slide, rect } of measurements) {
      const full = isHomeCardFullyVisible(rect, viewport);
      if (!full && slide.contains(document.activeElement)) swiper.el.focus({ preventScroll: true });
      slide.inert = !full;
      if (full) slide.removeAttribute("aria-hidden");
      else slide.setAttribute("aria-hidden", "true");
    }
    // CSS keeps both arrows at half the layout's card width. Following each
    // moving card edge makes the controls shrink, jump and vanish over gaps.
    // Reveal controls only after both track motion and card-width motion settle.
    // clickCapture still blocks card actions during navigation and on partial cards.
    syncArrows();
  }
  function trackEdges() {
    if (!isAvailable() || wasHidden || edgeFrame) return;
    edgeFrame = requestAnimationFrame(() => {
      edgeFrame = 0;
      if (!isAvailable() || wasHidden) return;
      syncEdges();
      if (swiper.animating || layoutMoving) trackEdges();
    });
  }
  function cancelWidths() {
    const previous = widthAnimations;
    widthAnimations = null;
    previous?.forEach(animation => animation.cancel());
    layoutMoving = false;
    swiper.allowTouchMove = true;
  }
  function animateWidths(oldWidth: number, newWidth: number, duration: number) {
    if (!duration || Math.abs(oldWidth - newWidth) < 0.1 || !swiper.slides[0]?.animate) {
      layoutMoving = false;
      swiper.allowTouchMove = true;
      syncEdges();
      return;
    }
    layoutMoving = true;
    swiper.allowTouchMove = false;
    const animations = swiper.slides.map(slide => slide.animate(
      [{ width: `${oldWidth}px` }, { width: `${newWidth}px` }], { duration, easing: "ease" },
    ));
    widthAnimations = animations;
    Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (!isAvailable() || widthAnimations !== animations) return;
      widthAnimations = null;
      layoutMoving = false;
      swiper.allowTouchMove = true;
      syncEdges();
    }).catch(() => { /* Resize/unmount cancels both width and track motion. */ });
    trackEdges();
  }
  function prepareBalancedLayout() {
    if (layout === "balanced") return null;
    const oldWidth = geometry.cardWidth;
    layout = "balanced";
    applyGeometry();
    swiper.updateSlides();
    return { oldWidth, newWidth: geometry.cardWidth };
  }
  function finishNavigation() {
    if (!isAvailable() || wasHidden) return;
    if (started && layout !== "balanced" && !swiper.animating && !layoutMoving && !swiper.touchEventsData.isTouched) {
      const widths = prepareBalancedLayout()!;
      const duration = mediaQuery.matches ? 0 : 260;
      layoutMoving = Boolean(duration);
      swiper.allowTouchMove = !duration;
      swiper.slideTo(swiper.activeIndex, duration, false);
      animateWidths(widths.oldWidth, widths.newWidth, duration);
    }
    syncEdges();
  }
  function beginBrowsing() {
    started = true;
    touchMoving = true;
    stage.dataset.started = "true";
    syncArrows();
    trackEdges();
  }
  function transitionStart() {
    // Swiper emits this just before setting animating=true. Hide immediately,
    // then let subsequent frames and completion callbacks read its actual state.
    syncArrows(true);
    trackEdges();
  }
  function move(direction: -1 | 1) {
    if (!isAvailable() || wasHidden || swiper.animating || layoutMoving || touchMoving || swiper.touchEventsData.isTouched) return;
    swiper.loopFix({ direction: direction > 0 ? "next" : "prev" });
    // Flush the compensated loop position before the page transition starts.
    void swiper.wrapperEl.clientLeft;
    const target = swiper.activeIndex + direction * geometry.pageSize;
    if (target < 0 || target >= swiper.snapGrid.length) return;
    started = true;
    stage.dataset.started = "true";
    const widths = prepareBalancedLayout();
    const duration = mediaQuery.matches ? 0 : 460;
    if (widths) { layoutMoving = Boolean(duration); swiper.allowTouchMove = !duration; }
    syncArrows(Boolean(duration));
    swiper.slideTo(target, duration);
    if (widths) animateWidths(widths.oldWidth, widths.newWidth, duration);
    syncArrows();
    trackEdges();
  }
  function suspend() {
    // display:none cancels CSS transitions without transitionend. Set the hidden
    // guard before notifying Swiper so callbacks cannot restart animation work.
    wasHidden = true;
    cancelAnimationFrame(edgeFrame);
    cancelAnimationFrame(touchFrame);
    cancelAnimationFrame(alignmentFrame);
    edgeFrame = touchFrame = alignmentFrame = 0;
    cancelWidths();
    swiper.setTransition(0);
    swiper.wrapperEl.dispatchEvent(new Event("transitionend"));
    swiper.animating = false;
    touchMoving = false;
    syncArrows(false);
  }
  function resize() {
    if (!isAvailable()) return;
    if (stage.getBoundingClientRect().width <= 0) { suspend(); return; }
    cancelWidths();
    swiper.setTransition(0);
    // Finish Swiper's existing transition listener before its resize realignment.
    swiper.wrapperEl.dispatchEvent(new Event("transitionend"));
    swiper.animating = false;
    touchMoving = false;
    applyGeometry();
    syncArrows();
  }
  function touchEnd() {
    cancelAnimationFrame(touchFrame);
    touchFrame = requestAnimationFrame(() => {
      touchFrame = 0;
      if (!isAvailable()) return;
      touchMoving = false;
      finishNavigation();
      trackEdges();
    });
  }
  function clickCapture(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    const slide = target?.closest<HTMLElement>("[data-home-slide]");
    if (!slide) return;
    if (swiper.animating || layoutMoving || touchMoving || !swiper.allowClick ||
      !isHomeCardFullyVisible(slide.getBoundingClientRect(), swiper.el.getBoundingClientRect())) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  function keyDown(event: KeyboardEvent) {
    if (event.target !== swiper.el || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    }
  }
  function wheel(event: WheelEvent) {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 1) return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheel > 180) wheelTotal = 0;
    lastWheel = now;
    if (swiper.animating || layoutMoving || touchMoving) { wheelTotal = 0; return; }
    wheelTotal += event.deltaX;
    if (Math.abs(wheelTotal) > 28) {
      move(wheelTotal > 0 ? 1 : -1);
      wheelTotal = 0;
    }
  }
  function motionChange() {
    swiper.params.speed = mediaQuery.matches ? 0 : 360;
    swiper.originalParams.speed = swiper.params.speed;
    if (mediaQuery.matches) {
      resize();
      swiper.update();
      syncEdges();
    }
  }
  function destroy() {
    if (disposed) return;
    options.savePosition({ started, index: needsInitialAlignment ? options.initialPosition.index : swiper.realIndex % options.itemCount });
    disposed = true;
    cancelAnimationFrame(edgeFrame);
    cancelAnimationFrame(touchFrame);
    cancelAnimationFrame(alignmentFrame);
    cancelWidths();
    resizeObserver?.disconnect();
    mediaQuery.removeEventListener("change", motionChange);
    swiper.el.removeEventListener("click", clickCapture, true);
    swiper.el.removeEventListener("keydown", keyDown);
    stage.removeEventListener("wheel", wheel);
  }

  applyGeometry();
  // The core supports an offset callback, although its published type says number.
  Object.assign(swiper.params, { slidesOffsetBefore: () => geometry.offset });
  swiper.originalParams.slidesOffsetBefore = swiper.params.slidesOffsetBefore;
  swiper.params.initialSlide = options.initialPosition.index;
  swiper.params.speed = mediaQuery.matches ? 0 : 360;
  swiper.on("init", syncEdges);
  // The home page is hidden while global search is open. Only observe width:
  // card-height animation must not make Swiper interrupt its own transition.
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (!isAvailable() || !swiper.initialized) return;
      const width = stage.getBoundingClientRect().width;
      if (width <= 0) { suspend(); return; }
      if (wasHidden || Math.abs(width - measuredWidth) > 0.5) {
        // A hidden first drag may never finish its compact-to-balanced transition.
        if (wasHidden && started) layout = "balanced";
        wasHidden = false;
        resize();
        swiper.update();
        if (needsInitialAlignment) {
          // A zero-width init cannot determine loop indices. Restore the intended
          // source item once, rather than keeping that arbitrary hidden index.
          cancelAnimationFrame(alignmentFrame);
          swiper.slideToLoop(options.initialPosition.index, 0, false);
          alignmentFrame = requestAnimationFrame(() => {
            alignmentFrame = 0;
            if (!isAvailable()) return;
            needsInitialAlignment = false;
            syncEdges();
          });
        }
        syncEdges();
      }
    });
    resizeObserver.observe(stage);
  }
  swiper.on("sliderFirstMove", beginBrowsing);
  swiper.on("setTranslate", trackEdges);
  swiper.on("transitionStart", transitionStart);
  swiper.on("transitionEnd", finishNavigation);
  swiper.on("touchEnd", touchEnd);
  swiper.on("beforeResize", resize);
  swiper.on("resize", trackEdges);
  swiper.on("beforeDestroy", destroy);
  mediaQuery.addEventListener("change", motionChange);
  swiper.el.addEventListener("click", clickCapture, true);
  swiper.el.addEventListener("keydown", keyDown);
  stage.addEventListener("wheel", wheel, { passive: false });
  return { move, destroy };
}
