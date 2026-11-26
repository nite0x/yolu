export type ReadRequest = (path: string, options: RequestInit) => Promise<Response>

// One coordinator per application host. Panes borrow responses, never ownership
// of an abort signal or a mutation. A mutation invalidates both sides of its run.
export function createRequestCache(fetcher: ReadRequest, now = Date.now) {
  const reads = new Map<string, {updated: number | null; promise: Promise<Response>}>()
  const ttl = 1000
  return {
    read(path: string, options: RequestInit = {}) {
      const method = (options.method || "GET").toUpperCase()
      if (method !== "GET") {
        reads.clear()
        return fetcher(path, options).finally(() => reads.clear())
      }
      if (/[?&]refresh=1(?:&|$)/.test(path)) { reads.clear(); return fetcher(path, options) }
      const cacheable = /^\/api\/(state|environments|resource-icons)(\?|$)/.test(path)
        || /^\/api\/sessions(?:\?|$|\/search$)/.test(path)
      if (options.signal || ["no-store", "no-cache", "reload"].includes(options.cache || "") || !cacheable) return fetcher(path, options)
      const url = new URL(path, "http://localhost")
      url.searchParams.sort()
      const headers = [...new Headers(options.headers).entries()].sort(([a], [b]) => a.localeCompare(b))
      const key = JSON.stringify([url.pathname + url.search, headers, options.credentials, options.cache])
      const cached = reads.get(key)
      if (cached && (cached.updated === null || now() - cached.updated < ttl)) return cached.promise.then(response => response.clone())
      const entry = {updated: null as number | null, promise: Promise.resolve(new Response())}
      entry.promise = fetcher(path, options).then(response => {
        entry.updated = now()
        if (!response.ok && reads.get(key) === entry) reads.delete(key)
        return response
      }, error => { if (reads.get(key) === entry) reads.delete(key); throw error })
      reads.set(key, entry)
      for (const [key, value] of reads) if (value.updated !== null && now() - value.updated >= ttl) reads.delete(key)
      return entry.promise.then(response => response.clone())
    },
    invalidate() { reads.clear() },
  }
}
