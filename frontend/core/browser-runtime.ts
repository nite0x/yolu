import {createAPIClient} from './api-client'
import {createRequestCache} from './request-cache'
import {postPageMessage, readPageMessage} from './page-protocol'

export const browserRuntime = {createAPIClient, createRequestCache, postPageMessage, readPageMessage}
window.WorkHubBrowser = browserRuntime
declare global { interface Window { WorkHubBrowser: typeof browserRuntime } }
