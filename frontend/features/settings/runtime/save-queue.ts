/** Settings sharing a scope are serialized; independent environments remain independent. */
export function createSettingsSaveQueue() {
  const pending = new Map<string, Promise<unknown>>()
  return {
    wait(key: string) {
      return pending.get(key)?.catch(() => {})
    },
    enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
      const next = (pending.get(key) || Promise.resolve()).catch(() => {}).then(operation)
      pending.set(key, next)
      const clean = () => {
        if (pending.get(key) === next) pending.delete(key)
      }
      void next.then(clean, clean)
      return next
    },
  }
}
