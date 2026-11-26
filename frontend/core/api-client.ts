import type {APIErrorResponse} from "@/api/contracts"
import type {ReadRequest} from "./request-cache"

export class APIError extends Error {
  readonly code?: string
  readonly command?: string
  readonly requestID?: string
  constructor(readonly status: number, payload: APIErrorResponse, translate: (text: string) => string, requestID?: string) {
    super([payload.error, ...(payload.details || [])].filter(Boolean).map(translate).join("\n") || String(status))
    this.name = "APIError"
    this.code = payload.code
    this.command = payload.command
    this.requestID = payload.request_id || requestID
  }
}

export type APIOptions = RequestInit & {environment?: string}
export interface APIContext {environment: string; revision: number}

export function createAPIClient(options: {
  token: string; context: () => APIContext; read: ReadRequest; text: (message: string) => string
}) {
  return async function request<T>(path: string, input: APIOptions = {}): Promise<T> {
    const before = options.context()
    const {environment = before.environment, ...init} = input
    const headers: Record<string, string> = {'Content-Type': 'application/json', 'X-CSRF-Token': options.token, 'X-Environment-ID': environment}
    new Headers(init.headers).forEach((value, name) => {
      const key = Object.keys(headers).find(key => key.toLowerCase() === name) || name
      headers[key] = value
    })
    // Keep a plain header record for existing native/remote request adapters.
    const response = await options.read(path, {...init, headers})
    const check = () => {
      if (input.environment === undefined && before.revision !== options.context().revision) throw new DOMException(options.text("执行环境已切换"), 'AbortError')
    }
    check()
    let data: T & APIErrorResponse
    try { data = await response.json() } catch {
      check()
      throw new Error(options.text("服务返回了无法读取的响应，请查看服务日志。"))
    }
    check()
    if (!response.ok) throw new APIError(response.status, data, options.text, response.headers?.get('X-Request-ID') || undefined)
    return data
  }
}
