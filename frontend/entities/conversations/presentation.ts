import {uiText, uiLocale} from "@/shared/i18n"

export const sessionTime = (value?: number) => value ? new Date(value * 1000).toLocaleString(uiLocale(), { hour12: false }) : uiText("暂无活动记录")
