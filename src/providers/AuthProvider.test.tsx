// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";

const sessionState = vi.hoisted(() => ({
  value: {
    data: null as {
      user: {
        id: string;
        email?: string | null;
        user_metadata?: {
          full_name?: string | null;
          avatar_url?: string | null;
        };
      };
    } | null,
    status: "unauthenticated" as
      | "authenticated"
      | "unauthenticated"
      | "loading",
  },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => sessionState.value,
}));

describe("AuthProvider", () => {
  let root: Root | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    sessionState.value = {
      data: null,
      status: "unauthenticated",
    };
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    document.body.innerHTML = "";
    root = null;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("相同使用者內容重新驗證時維持 session 參考", async () => {
    const observedSessions: Array<ReturnType<typeof useAuth>["session"]> = [];

    function Consumer() {
      observedSessions.push(useAuth().session);
      return null;
    }

    const render = async () => {
      await act(async () => {
        root!.render(
          createElement(AuthProvider, null, createElement(Consumer)),
        );
      });
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    sessionState.value = {
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
          user_metadata: {
            full_name: "使用者",
            avatar_url: "https://example.com/avatar.png",
          },
        },
      },
      status: "authenticated",
    };

    await render();
    const initialSession = observedSessions.at(-1);

    sessionState.value = {
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
          user_metadata: {
            full_name: "使用者",
            avatar_url: "https://example.com/avatar.png",
          },
        },
      },
      status: "authenticated",
    };
    await render();

    expect(observedSessions.at(-1)).toBe(initialSession);
  });
});
