import { uiText } from "../i18n";
import {entryKey, mergeEntries, mergeHistoryEntries, type Entry, type Session} from "./model";
import type {ChatOptions, Snapshot} from "./controller-types";

interface History {session: Session; entries: Entry[]; next_cursor?: string | null; has_user_message?: boolean}
interface Lifecycle {
  connected: boolean;
  visible: boolean;
  generation: number;
  revision: number;
  sessionRevision: number;
  signal?: AbortSignal;
}

// Saved-history pagination owns its cursor validation and known-entry set.
// Live streams remain with the controller and supply revision guards so a late
// saved page cannot replace newer output or a manually changed session title.
export function createHistoryLoader(options: {
  request: ChatOptions["request"];
  base: () => string;
  snapshot: () => Snapshot;
  lifecycle: () => Lifecycle;
  readOnly: () => boolean;
  update: (patch: Partial<Snapshot>) => void;
  loaded: (session: Session) => void;
  synchronized: () => void;
}) {
  let loading = false;
  const savedKeys = new Set<string>();
  return {
    reset() { loading = false; },
    async load(older = false, background = false) {
      const initial = options.snapshot(), observed = options.lifecycle();
      if (!initial.session || loading || !observed.connected || !observed.visible) return;
      const cursor = older ? initial.cursor : null;
      if (older && !cursor) return;
      loading = true;
      options.update({loading: !background || !initial.entries.length, historyError: ""});
      const current = () => observed.generation === options.lifecycle().generation;
      try {
        let page = await options.request<History>(options.base() + "/history" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""), {signal: observed.signal});
        if (!current()) return;
        if (cursor && page.next_cursor === cursor) throw new Error(uiText("历史分页游标重复"));
        let fresh = page.entries;
        const cursors = new Set<string>();
        while (!older && page.next_cursor && (savedKeys.size > 0 && !fresh.some(e => savedKeys.has(entryKey(e))) || !options.readOnly() && page.has_user_message === false && !fresh.some(e => e.kind === "user"))) {
          if (cursors.has(page.next_cursor)) throw new Error(uiText("历史分页游标重复"));
          cursors.add(page.next_cursor);
          page = await options.request<History>(options.base() + "/history?cursor=" + encodeURIComponent(page.next_cursor), {signal: observed.signal});
          if (!current()) return;
          fresh = [...page.entries, ...fresh];
        }
        const snapshot = options.snapshot(), lifecycle = options.lifecycle();
        const entries = older ? mergeEntries(fresh, snapshot.entries) : mergeHistoryEntries(snapshot.entries, fresh);
        const live = snapshot.terminal?.entries.filter(e => e.status === "inProgress" || observed.revision !== lifecycle.revision) || [];
        const session = {...snapshot.session, ...page.session};
        if (observed.sessionRevision !== lifecycle.sessionRevision && snapshot.session) session.name = snapshot.session.name;
        options.update({session, entries: mergeEntries(entries, live), cursor: older || !savedKeys.size ? page.next_cursor || null : snapshot.cursor});
        options.loaded(session);
        for (const entry of fresh) savedKeys.add(entryKey(entry));
        if (!older && observed.revision === options.lifecycle().revision) options.synchronized();
      } catch (error) {
        if (current() && !observed.signal?.aborted) options.update({historyError: (error as Error).message});
      } finally {
        if (current()) { loading = false; options.update({loading: false}); }
      }
    },
  };
}
