import { uiText } from "../i18n";
import {cacheDraft, validDraft, type DraftRecord} from "./drafts";

type Request = <T>(path: string, options?: RequestInit) => Promise<T>;

// Own timestamps, debouncing and write ordering. The chat controller supplies
// the current draft and applies restores; persistence never owns message state.
export function createDraftPersistence(options: {
  request: Request;
  key: () => string;
  enabled: () => boolean;
  connected: () => boolean;
  submitting: () => boolean;
  capture: () => Omit<DraftRecord, "updated">;
  restore: (record: DraftRecord) => void;
  notice: (message: string) => void;
}) {
  let revision = 0, updated = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();
  let lastWriteSucceeded = true;
  function restore(record: DraftRecord) { updated = record.updated; options.restore(record); }
  function write(key: string, record: DraftRecord) {
    cacheDraft(key, record);
    writes = writes.then(async () => {
      try {
        await options.request("/api/conversation-drafts?key=" + encodeURIComponent(key), {method: "POST", body: JSON.stringify(record)});
        lastWriteSucceeded = true;
        options.notice("");
      } catch {
        lastWriteSucceeded = false;
        options.notice(uiText("草稿暂未保存到后台，连接恢复后会重试，请保持页面打开"));
        if (options.connected()) { clearTimeout(timer); timer = setTimeout(persist, 5000); }
      }
    });
  }
  function persist() {
    clearTimeout(timer);
    if (!options.enabled()) return;
    updated = Math.max(Date.now(), updated + 1);
    write(options.key(), {...options.capture(), updated});
  }
  return {
    restore, persist, write,
    async flush() { persist(); await writes; return lastWriteSucceeded; },
    changed() {
      revision++;
      if (!options.enabled()) return;
      clearTimeout(timer);
      timer = setTimeout(persist, 350);
    },
    async load() {
      const observed = revision;
      try {
        const saved = await options.request<unknown>("/api/conversation-drafts?key=" + encodeURIComponent(options.key()));
        if (options.connected() && revision === observed && validDraft(saved) && saved.updated >= updated && !options.submitting()) restore(saved);
      } catch { options.notice(uiText("暂时无法恢复本地草稿，将在下次保存时重试")); }
    },
  };
}
