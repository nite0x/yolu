import {useSyncExternalStore} from "react";

type SendShortcut = "enter" | "ctrlEnter";

declare global {
  interface Window {
    YoluChatInput?: {
      current(): SendShortcut;
      update(shortcut: SendShortcut): void;
      apply(shortcut: SendShortcut): void;
    };
  }
}

export function sendShortcut(): SendShortcut {
  return window.YoluChatInput?.current() || "enter";
}

function subscribe(listener: () => void) {
  window.addEventListener("yolu:chat-input", listener);
  return () => window.removeEventListener("yolu:chat-input", listener);
}

export function useSendShortcut(): SendShortcut {
  return useSyncExternalStore(subscribe, sendShortcut, () => "enter");
}
