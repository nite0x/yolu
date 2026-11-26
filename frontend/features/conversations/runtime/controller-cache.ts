interface RetainedController {
  prepareForEviction(): Promise<boolean>
  flushDraft(): Promise<boolean>
  dispose(): void
}

/** LRU retention. A failed save keeps its owner until a later successful retry. */
export function createControllerCache<T extends RetainedController>(
  limit: number,
  isActive: (value: T) => boolean,
) {
  const entries = new Map<string, {value: T; revision: number}>()
  let revision = 0
  let trimming: Promise<void> | undefined
  let requested = false
  const trim = () => {
    requested = true
    if (trimming) return trimming
    trimming = (async () => {
      while (requested) {
        requested = false
        for (const [key, entry] of entries) {
          if (entries.size <= limit) break
          if (isActive(entry.value)) continue
          const observed = entry.revision
          let saved = false
          try {
            saved = await entry.value.prepareForEviction()
          } catch {
            /* Preserve the draft owner. */
          }
          if (!saved || isActive(entry.value) || entries.get(key) !== entry || entry.revision !== observed)
            continue
          entries.delete(key)
          entry.value.dispose()
        }
      }
    })().finally(() => {
      trimming = undefined
    })
    return trimming
  }
  return {
    get size() {
      return entries.size
    },
    get(key: string) {
      const entry = entries.get(key)
      if (!entry) return undefined
      entry.revision = ++revision
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },
    set(key: string, value: T) {
      entries.delete(key)
      entries.set(key, {value, revision: ++revision})
    },
    delete(key: string) {
      entries.delete(key)
    },
    trim,
    async flush() {
      const results = await Promise.all(
        [...new Set([...entries.values()].map((entry) => entry.value))].map((value) =>
          value.flushDraft().catch(() => false),
        ),
      )
      return results.every(Boolean)
    },
  }
}
