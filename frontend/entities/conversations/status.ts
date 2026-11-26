import type {Session} from "./catalog"

export function conversationStatusMatches(session: Session, status: string) {
  if (status === "running") return ["starting", "running", "stopping", "handoff"].includes(session.chat_status || "")
  if (status === "waiting") return session.chat_status === "waiting"
  if (status === "unread") return !!session.unread
  return true
}
