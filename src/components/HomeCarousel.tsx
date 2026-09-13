"use client";

import { useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import { createHomeCarouselController, type HomeCarouselPosition } from "@/features/home/homeCarouselController";
import { getHomeCarouselCopies } from "@/features/home/homeCarouselGeometry";
import styles from "./HomeCarousel.module.css";

type HomeCarouselProps = {
  label: string;
  itemCount: number;
  renderItem(index: number, copy: number): ReactNode;
  /** Change only when the source item order changes, never for watchlist/status updates. */
  resetKey?: string;
};

type PositionRef = { current: HomeCarouselPosition };
const getServerCapacity = () => 1920;
const getViewportCapacity = () => Math.max(1920, Math.ceil(window.innerWidth / 1920) * 1920);
function subscribeViewportCapacity(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

function CarouselTrack({ label, itemCount, renderItem, copies, position }: HomeCarouselProps & {
  copies: number;
  position: PositionRef;
}) {
  const id = useId();
  const controller = useRef<ReturnType<typeof createHomeCarouselController> | null>(null);
  return (
    <div className={styles.stage} data-home-carousel data-started="false" data-layout="compact">
      <Swiper
        id={id}
        className={styles.track}
        tabIndex={0}
        role="region"
        aria-roledescription="輪播"
        aria-label={`${label}，${itemCount} 部作品，可左右連續瀏覽`}
        loop
        slidesPerView="auto"
        slidesPerGroup={1}
        grabCursor
        resizeObserver={false}
        preventInteractionOnTransition
        preventClicks
        preventClicksPropagation
        focusableElements="input, select, option, textarea, button:not([data-home-detail]), video, label"
        noSwipingSelector="[data-home-bookmark]"
        onBeforeInit={(swiper) => {
          controller.current = createHomeCarouselController(swiper, {
            itemCount,
            initialPosition: position.current,
            savePosition: (nextPosition) => { position.current = nextPosition; },
          });
        }}
      >
        {Array.from({ length: copies * itemCount }, (_, index) => (
          <SwiperSlide key={index} className={styles.slide} data-home-slide data-home-index={index % itemCount}>
            {renderItem(index % itemCount, Math.floor(index / itemCount))}
          </SwiperSlide>
        ))}
      </Swiper>
      <div className={styles.mask} aria-hidden="true" />
      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.arrow} ${styles.previous}`}
          data-home-prev
          hidden
          aria-controls={id}
          aria-label={`${label}：向左瀏覽`}
          title="向左瀏覽"
          onClick={() => controller.current?.move(-1)}
        >
          <svg viewBox="0 0 24 32" aria-hidden="true"><path d="m15 7-8 9 8 9" /></svg>
        </button>
        <button
          type="button"
          className={`${styles.arrow} ${styles.next}`}
          data-home-next
          aria-controls={id}
          aria-label={`${label}：向右瀏覽`}
          title="向右瀏覽"
          onClick={() => controller.current?.move(1)}
        >
          <svg viewBox="0 0 24 32" aria-hidden="true"><path d="m9 7 8 9-8 9" /></svg>
        </button>
      </div>
    </div>
  );
}

function CarouselItems(props: HomeCarouselProps) {
  const capacity = useSyncExternalStore(subscribeViewportCapacity, getViewportCapacity, getServerCapacity);
  const position = useRef<HomeCarouselPosition>({ started: false, index: 0 });
  if (props.itemCount <= 0) return null;
  if (props.itemCount === 1) {
    return (
      <div className={`${styles.stage} ${styles.static}`} role="region" aria-label={`${props.label}，1 部作品`}>
        <div className={styles.slide}>{props.renderItem(0, 0)}</div>
      </div>
    );
  }
  const copies = getHomeCarouselCopies(props.itemCount, capacity);
  return <CarouselTrack key={copies} {...props} copies={copies} position={position} />;
}

export default function HomeCarousel(props: HomeCarouselProps) {
  // A source-list replacement has a new track; ordinary React prop updates keep
  // the same slides, DOM focus and controller while updating every local copy.
  return <CarouselItems key={props.resetKey ?? props.itemCount} {...props} />;
}
