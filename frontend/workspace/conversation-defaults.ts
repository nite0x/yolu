// Non-sensitive creation preferences are shared by the host and its panes.
// Storage may be disabled; creation must still work with built-in defaults.
export const conversationDefaults = {
  get(key: string): string {
    try { return localStorage.getItem(`workhub:conversation-defaults:v1:${key}`) || "" } catch { return "" }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(`workhub:conversation-defaults:v1:${key}`, value) } catch {}
  },
}
