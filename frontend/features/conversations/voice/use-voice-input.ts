import {useEffect, useRef, useState, type RefObject} from "react"
import {useAui} from "@assistant-ui/react"
import {CodexVoiceInput, type VoiceInputState} from "./client"
import {uiText} from "@/shared/i18n"

export function useVoiceInput(root: RefObject<HTMLFormElement | null>, maxLength: number) {
  const aui = useAui();
  const session = useRef<CodexVoiceInput | undefined>(undefined);
  const [state, setState] = useState<VoiceInputState>("idle");
  const [error, setError] = useState("");

  const start = () => {
    if (session.current) return;
    setError("");
    let first = true;
    const current = new CodexVoiceInput({
      state(next) {
        if (session.current !== current) return;
        setState(next);
        if (next === "idle") {
          session.current = undefined;
          requestAnimationFrame(() => {
            if (!session.current && !document.hidden && !document.documentElement.hasAttribute("data-workspace-inactive") && !root.current?.closest("[hidden], [inert]")) root.current?.querySelector("textarea")?.focus();
          });
        }
      },
      transcript(fragment) {
        if (session.current !== current) return;
        const text = aui.composer.getState().text;
        if (first && !text) fragment = fragment.trimStart();
        if (!fragment) return;
        if (first && text && !/\s$/.test(text) && !/^\s/.test(fragment)) fragment = " " + fragment;
        first = false;
        aui.composer.setText(text + fragment.slice(0, Math.max(0, maxLength - text.length)));
        if (text.length + fragment.length > maxLength) {
          setError(uiText("草稿已达到字数上限，听写已停止。"));
          current.stop();
        }
      },
      error(message) { if (session.current === current) setError(message); },
    });
    session.current = current;
    void current.start();
  };

  useEffect(() => {
    const cancel = () => session.current?.cancel();
    const hidden = () => {
      if (document.hidden || document.documentElement.hasAttribute("data-workspace-inactive") || root.current?.closest("[hidden], [inert]")) cancel();
    };
    const observer = new MutationObserver(hidden);
    observer.observe(document.documentElement, {subtree: true, attributes: true, attributeFilter: ["hidden", "inert", "data-workspace-inactive"]});
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", cancel);
    window.addEventListener("workhub:assistant-hide", cancel);
    return () => {
      const current = session.current;
      session.current = undefined;
      current?.cancel();
      observer.disconnect();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cancel);
      window.removeEventListener("workhub:assistant-hide", cancel);
    };
  }, [root]);

  return {state, error, active: state !== "idle", start, stop: () => session.current?.stop()};
}
