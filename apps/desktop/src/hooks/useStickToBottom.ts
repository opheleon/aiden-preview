import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

/** Within this many pixels of the bottom counts as reading the newest message. */
const nearPx = 80;
/** Keys that move a scrolled thread up. */
const upKeys = new Set(['ArrowUp', 'PageUp', 'Home']);

/** What a scrolling thread offers its page. */
export interface StickToBottom {
  /** Whether the thread keeps the newest content in view as it grows. */
  following: RefObject<boolean>;
  /** Show the top of this element instead of the bottom until the next new message or scroll. */
  hold: (target: Element) => void;
  /** Jump to the newest content and keep following it. */
  follow: () => void;
  /** New content arrived while the person was reading further up. */
  behind: boolean;
}

/**
 * Keep a scrolling thread on its newest content. Any growth (a new message, live progress text,
 * a card opening, a bar above shrinking the thread) pins it to the bottom while following. Only
 * the person can stop following, by scrolling up with the wheel, touch, keys, or scrollbar;
 * scrolls the app makes never count. Example: a long reply opens at its top through `hold`, and
 * the next message still pulls the thread to the bottom.
 */
export function useStickToBottom(
  thread: RefObject<HTMLElement | null>,
  active: boolean,
): StickToBottom {
  const following = useRef(true);
  const held = useRef<Element | null>(null);
  const [behind, setBehind] = useState(false);
  /** Put the thread where it belongs: the held element's top, or the bottom. */
  const pin = useCallback(() => {
    const element = thread.current;
    if (!element || !following.current) return;
    const target = held.current;
    element.scrollTop =
      target && element.contains(target)
        ? target.getBoundingClientRect().top -
          element.getBoundingClientRect().top +
          element.scrollTop
        : element.scrollHeight;
  }, [thread]);
  const follow = useCallback(() => {
    following.current = true;
    held.current = null;
    setBehind(false);
    pin();
  }, [pin]);
  const hold = useCallback(
    (target: Element) => {
      held.current = target;
      pin();
    },
    [pin],
  );
  useEffect(() => {
    const element = thread.current;
    if (!active || !element) return;
    /** The person moved up: stop following until they come back near the bottom. */
    const leave = () => {
      following.current = false;
      held.current = null;
    };
    /** Whether the view sits near the bottom. */
    const atBottom = () => element.scrollHeight - element.scrollTop - element.clientHeight < nearPx;
    let dragging = false;
    /** Scrolling the wheel up means reading back. */
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) leave();
    };
    /** Arrow up, Page Up, and Home mean reading back. */
    const onKey = (event: KeyboardEvent) => {
      if (upKeys.has(event.key)) leave();
    };
    /** Dragging the thread by touch means reading back. */
    const onTouch = () => leave();
    /** A press right of the content box lands on the scrollbar. */
    const onPointer = (event: PointerEvent) => {
      dragging = event.offsetX > element.clientWidth;
    };
    /** The scrollbar drag ended. */
    const onRelease = () => {
      dragging = false;
    };
    /** A scrollbar drag up leaves; coming back near the bottom follows again. */
    const onScroll = () => {
      if (dragging && !atBottom()) leave();
      else if (!following.current && atBottom()) {
        following.current = true;
        setBehind(false);
      }
    };
    /** Content changed size: keep up while following, otherwise say something new is below. */
    const grown = () => {
      if (following.current) pin();
      else if (!atBottom()) setBehind(true);
    };
    const sizes = new ResizeObserver(grown);
    sizes.observe(element);
    for (const child of Array.from(element.children)) sizes.observe(child);
    const children = new MutationObserver((changes) => {
      for (const change of changes)
        for (const node of Array.from(change.addedNodes))
          if (node instanceof Element) sizes.observe(node);
      grown();
    });
    children.observe(element, { childList: true });
    element.addEventListener('wheel', onWheel, { passive: true });
    element.addEventListener('keydown', onKey);
    element.addEventListener('touchmove', onTouch, { passive: true });
    element.addEventListener('pointerdown', onPointer);
    window.addEventListener('pointerup', onRelease);
    element.addEventListener('scroll', onScroll, { passive: true });
    pin();
    return () => {
      sizes.disconnect();
      children.disconnect();
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('keydown', onKey);
      element.removeEventListener('touchmove', onTouch);
      element.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('pointerup', onRelease);
      element.removeEventListener('scroll', onScroll);
    };
  }, [thread, active, pin]);
  return { following, hold, follow, behind };
}
