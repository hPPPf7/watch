// @vitest-environment jsdom
import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useModalFocus from "./useModalFocus";

let host: HTMLDivElement;
let opener: HTMLButtonElement;
let root: Root | null;

function Dialog({ id, open = true, onEscape = () => undefined, children }: {
  id: string; open?: boolean; onEscape?: () => void; children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref, open, onEscape);
  return open ? <div ref={ref} id={id} role="dialog" tabIndex={-1}>{children}</div> : null;
}

function Nested({ child = false, onParentEscape = () => undefined, onChildEscape = () => undefined }: {
  child?: boolean; onParentEscape?: () => void; onChildEscape?: () => void;
}) {
  return <Dialog id="parent" onEscape={onParentEscape}>
    <button id="confirm-trigger">Confirm</button>
    <Dialog id="child" open={child} onEscape={onChildEscape}><button id="confirm">Accept</button></Dialog>
  </Dialog>;
}

const element = (id: string) => document.getElementById(id) as HTMLElement;
const render = async (content: ReactNode) => { await act(async () => { root!.render(content); }); };
const press = async (key: string, options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => { document.activeElement!.dispatchEvent(event); });
  return event;
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  opener = document.createElement("button");
  opener.textContent = "Open details";
  host = document.createElement("div");
  document.body.append(opener, host);
  opener.focus();
  root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host.remove();
  opener.remove();
  vi.restoreAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("modal keyboard focus", () => {
  it("focuses the dialog initially and wraps Tab and Shift+Tab at its boundaries", async () => {
    await render(<Dialog id="dialog"><button id="first">First</button><button id="last">Last</button></Dialog>);
    expect(document.activeElement).toBe(element("dialog"));
    expect((await press("Tab")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element("first"));
    expect((await press("Tab", { shiftKey: true })).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element("last"));
    expect((await press("Tab")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element("first"));
    // Native tabbing between controls remains available; jsdom does not perform it.
    expect((await press("Tab")).defaultPrevented).toBe(false);
    element("dialog").focus();
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(element("last"));
  });

  it("excludes disabled, hidden and inert controls from the keyboard boundaries", async () => {
    await render(<Dialog id="dialog">
      <input type="hidden" />
      <button disabled>Disabled</button>
      <fieldset disabled><button>Disabled by fieldset</button></fieldset>
      <div hidden><button>Hidden by attribute</button></div>
      <div style={{ display: "none" }}><button>Hidden by display</button></div>
      <div style={{ visibility: "hidden" }}><button>Hidden by visibility</button></div>
      <button id="first">First</button>
      <button tabIndex={-1}>Programmatic focus only</button>
      <button id="last">Last</button>
      <div inert><button>Inert</button></div>
      <div style={{ visibility: "collapse" }}><button>Collapsed</button></div>
    </Dialog>);
    await press("Tab");
    expect(document.activeElement).toBe(element("first"));
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(element("last"));
    await press("Tab");
    expect(document.activeElement).toBe(element("first"));
  });

  it("holds focus on an empty dialog and redirects focus that escapes", async () => {
    await render(<Dialog id="dialog"><button disabled>Unavailable</button></Dialog>);
    expect((await press("Tab")).defaultPrevented).toBe(true);
    expect((await press("Tab", { shiftKey: true })).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element("dialog"));
    opener.focus();
    expect(document.activeElement).toBe(element("dialog"));
  });

  it("only sends Escape to the uppermost dialog and restores its trigger on close", async () => {
    const parentEscape = vi.fn(), childEscape = vi.fn();
    await render(<Nested onParentEscape={parentEscape} onChildEscape={childEscape} />);
    element("confirm-trigger").focus();
    await render(<Nested child onParentEscape={parentEscape} onChildEscape={childEscape} />);
    expect(document.activeElement).toBe(element("child"));
    expect((await press("Escape")).defaultPrevented).toBe(true);
    expect(childEscape).toHaveBeenCalledTimes(1);
    expect(parentEscape).not.toHaveBeenCalled();
    await render(<Nested onParentEscape={parentEscape} onChildEscape={childEscape} />);
    expect(document.activeElement).toBe(element("confirm-trigger"));
    await press("Escape");
    expect(parentEscape).toHaveBeenCalledTimes(1);
    expect(childEscape).toHaveBeenCalledTimes(1);
    await render(null);
    expect(document.activeElement).toBe(opener);
  });

  it.each(["close tree", "unmount root"])("restores the original opener when nested dialogs disappear together: %s", async (action) => {
    await render(<Nested />);
    element("confirm-trigger").focus();
    await render(<Nested child />);
    expect(document.activeElement).toBe(element("child"));
    if (action === "close tree") await render(null);
    else {
      await act(async () => { root!.unmount(); });
      root = null;
    }
    expect(document.activeElement).toBe(opener);
  });

  it("uses the latest Escape callback without moving focus on an ordinary rerender", async () => {
    const original = vi.fn(), current = vi.fn();
    await render(<Dialog id="dialog" onEscape={original}><button id="control">Control</button></Dialog>);
    element("control").focus();
    await render(<Dialog id="dialog" onEscape={current}><button id="control">Control</button></Dialog>);
    expect(document.activeElement).toBe(element("control"));
    await press("Escape");
    expect(original).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("leaves composing and already handled keyboard events alone", async () => {
    const close = vi.fn();
    await render(<Dialog id="dialog" onEscape={close}><input id="input" /></Dialog>);
    element("input").focus();
    expect((await press("Escape", { isComposing: true })).defaultPrevented).toBe(false);
    expect((await press("Escape", { keyCode: 229 })).defaultPrevented).toBe(false);
    const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    handled.preventDefault();
    await act(async () => { element("input").dispatchEvent(handled); });
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(element("input"));
    await press("Escape");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
