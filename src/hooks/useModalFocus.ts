"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

type ModalEntry = { dialog: HTMLElement; previous: HTMLElement | null };
const modalStack: ModalEntry[] = [];
const focusableSelector = 'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]';

function available(element: HTMLElement) {
  if (element.tabIndex < 0 || element.matches(":disabled, input[type=hidden]") || element.closest("[hidden], [inert]")) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

// Only the uppermost dialog receives keyboard events. Nested confirmations return
// focus to their trigger; closing the outer dialog returns focus to its card.
export default function useModalFocus(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onEscape: () => void,
) {
  const escapeRef = useRef(onEscape);
  useLayoutEffect(() => { escapeRef.current = onEscape; }, [onEscape]);

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry: ModalEntry = { dialog, previous };
    modalStack.push(entry);
    dialog.focus({ preventScroll: true });
    const isTop = () => modalStack.at(-1) === entry;
    const focusInside = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !dialog.contains(event.target)) {
        dialog.focus({ preventScroll: true });
      }
    };
    const keydown = (event: KeyboardEvent) => {
      if (!isTop() || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
      } else if (event.key === "Tab") {
        const controls = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter(available);
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        if (!first || !last) {
          event.preventDefault();
          dialog.focus({ preventScroll: true });
        } else if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusInside);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusInside);
      const wasTop = isTop();
      const index = modalStack.indexOf(entry);
      if (index !== -1) {
        // React can clean up a parent before its nested dialog. Preserve the
        // parent's opener so the final cleanup can return outside the removed tree.
        const next = modalStack[index + 1];
        if (next && (!next.previous?.isConnected || dialog.contains(next.previous))) {
          next.previous = entry.previous;
        }
        modalStack.splice(index, 1);
      }
      if (!wasTop) return;
      const remaining = modalStack.at(-1)?.dialog;
      const returnFocus = entry.previous;
      if (returnFocus?.isConnected && (!remaining || remaining.contains(returnFocus))) {
        returnFocus.focus({ preventScroll: true });
      } else {
        remaining?.focus({ preventScroll: true });
      }
    };
  }, [open, ref]);
}
