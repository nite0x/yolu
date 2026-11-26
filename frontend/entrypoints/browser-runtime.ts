import {createAPIClient} from "@/core/api-client"
import {createRequestCache} from "@/core/request-cache"
import {postPageMessage, readPageMessage} from "@/core/page-protocol"

export const browserRuntime = {createAPIClient, createRequestCache, postPageMessage, readPageMessage}
window.WorkHubBrowser = browserRuntime
declare global { interface Window { WorkHubBrowser: typeof browserRuntime } }
