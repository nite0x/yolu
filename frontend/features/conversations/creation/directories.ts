import {conversationDefaults} from "@/shared/lib/preferences"

type Usage = {at: number; id: string}
function usage(key: string): Usage[] {
  try {
    const data: unknown = JSON.parse(conversationDefaults.get(`directory-usage:${key}`) || "[]")
    return Array.isArray(data) ? data.filter((item): item is Usage => typeof item?.at === "number" && typeof item?.id === "string" && item.at > Date.now() - 14 * 86400000) : []
  } catch { return [] }
}
export function recordCreationDirectory(key: string, id: string, at = Date.now()) {
  if (!key || !Number.isFinite(at) || at < Date.now() - 14 * 86400000) return
  const items = usage(key)
  if (items.some(item => item.id === id)) return
  items.push({at, id})
  conversationDefaults.set(`directory-usage:${key}`, JSON.stringify(items.slice(-500)))
}
export function creationDirectoryPinned(key: string) { return conversationDefaults.get(`directory-pin:${key}`) === "true" }
export function pinCreationDirectory(key: string, pinned: boolean) { conversationDefaults.set(`directory-pin:${key}`, String(pinned)) }
export function rankCreationDirectories<T extends {value: string}>(items: T[]): T[] {
  const scores = new Map(items.map(item => {
    const visits = usage(item.value)
    const last = Math.max(0, ...visits.map(visit => visit.at))
    return [item.value, visits.length + (last ? Math.max(0, 1 - (Date.now() - last) / (14 * 86400000)) : 0)]
  }))
  return [...items].sort((a, b) => Number(creationDirectoryPinned(b.value)) - Number(creationDirectoryPinned(a.value))
    || (scores.get(b.value) ?? 0) - (scores.get(a.value) ?? 0))
}
