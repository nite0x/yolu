import {projectUI} from "@/features/projects/bridge"
import {gitUI} from "@/features/git/bridge"
import {conversationUI} from "@/features/conversations/bridge"
import {filesUI} from "@/features/files/bridge"
import {settingsUI} from "@/features/settings/bridge"
import {sharedUI} from "./shared-ui"

// Only the application adapter composes the legacy browser contract. Features
// export their own adapters without reaching into window or other features.
export const workspaceUI = {...sharedUI, ...projectUI, ...gitUI, ...conversationUI, ...filesUI, ...settingsUI}

declare global { interface Window { WorkHubUI: typeof workspaceUI } }
