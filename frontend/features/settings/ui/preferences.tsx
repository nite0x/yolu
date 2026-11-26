import {useEffect, useRef, useState} from "react"
import {flushSync} from "react-dom"
import {uiText} from "@/shared/i18n"
import {Feedback} from "@/shared/ui/feedback/message"
import {createRecoverableRoot} from "@/shared/ui/feedback/root"
import {Field} from "@/shared/ui/forms/field"
import {HelpTip} from "@/shared/ui/help-tip"
import {SectionHeading} from "@/shared/ui/layout/section-heading"
import {Button} from "@/shared/ui/primitives/button"
import {NativeSelect, NativeSelectOption as Option} from "@/shared/ui/primitives/native-select"
import type {SettingsHost} from "../model/contracts"
import type {createSettingsSaveQueue} from "../runtime/save-queue"
import {control} from "./controls"

type Queue = ReturnType<typeof createSettingsSaveQueue>
type Props = {host: SettingsHost; saves: Queue}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const themes = [
  {value: "mint", label: "Yolu 薄荷", desc: "暖白 · 深青 · 薄荷绿", swatches: ["paper", "teal", "mint"]},
  {value: "classic", label: "经典蓝紫", desc: "冷白 · 蓝紫 · 淡紫", swatches: ["cool", "indigo", "lavender"]},
  {value: "light", label: "浅色", desc: "纯白 · 中性灰 · 蓝色", swatches: ["white", "gray", "blue"]},
  {value: "dark", label: "深色", desc: "深灰 · 石板 · 天蓝", swatches: ["night", "slate", "sky"]},
  {value: "system", label: "跟随系统", desc: "自动切换浅色/深色", swatches: ["white", "night", "blue"]},
]

export function AppearanceFields({
  value = "system",
  onChange,
  status = "",
  error = "",
}: {
  value?: string
  onChange?: (value: string) => void
  status?: string
  error?: string
}) {
  return (
    <>
      <SectionHeading
        id="appearanceTitle"
        title={uiText("界面配色")}
        className="settings-card-heading"
        actions={
          <span id="appearanceStatus" role="status" className="settings-inline-status">
            {status}
          </span>
        }
      />
      <fieldset id="colorThemeGroup" className="settings-theme-grid" aria-label={uiText("配色方案")}>
        {themes.map((theme) => (
          <label key={theme.value} className="settings-theme-option" title={uiText(theme.desc)}>
            <input
              type="radio"
              className="sr-only"
              name="color_theme"
              value={theme.value}
              checked={value === theme.value}
              readOnly={!onChange}
              onChange={() => onChange?.(theme.value)}
            />
            <span className="settings-theme-swatches" aria-hidden="true">
              {theme.swatches.map((swatch) => (
                <span key={swatch} className={`appearance-swatch-${swatch}`} />
              ))}
            </span>
            <span className="settings-theme-name">{uiText(theme.label)}</span>
          </label>
        ))}
      </fieldset>
      <Feedback id="appearanceError" tone="error" className="mt-3" hidden={!error}>
        {error}
      </Feedback>
    </>
  )
}

export function LanguageFields({
  value = "system",
  saved = "system",
  onChange,
  onCancel,
  onSave,
  pending = false,
  status = "",
}: {
  value?: string
  saved?: string
  onChange?: (value: string) => void
  onCancel?: () => void
  onSave?: () => void
  pending?: boolean
  status?: string
}) {
  const dirty = value !== saved
  return (
    <>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-label">
            <h3 id="languageTitle">{uiText("界面语言")}</h3>
            <HelpTip id="languageHelp" label={uiText("界面语言")}>
              {uiText("语言设置应用于所有项目和执行环境。应用时会重新加载界面，后台工作继续。")}
            </HelpTip>
          </div>
        </div>
        <div className="settings-row-control">
          <Field id="languageSelect" label={uiText("界面语言")} className="settings-inline-field">
            <NativeSelect
              id="languageSelect"
              name="language"
              size="sm"
              value={value}
              onChange={(event) => onChange?.(event.target.value)}
            >
              <Option value="system">{uiText("跟随系统")}</Option>
              <Option value="en">English</Option>
              <Option value="zh-CN">简体中文</Option>
            </NativeSelect>
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            id="cancelLanguage"
            hidden={!dirty}
            disabled={pending}
            onClick={onCancel}
          >
            {uiText("取消")}
          </Button>
          <Button
            type="button"
            size="sm"
            id="saveLanguage"
            hidden={!dirty}
            disabled={pending}
            onClick={onSave}
          >
            {uiText("应用并重新加载")}
          </Button>
        </div>
      </div>
      <p id="languageStatus" role="status" className="settings-help">
        {status}
      </p>
    </>
  )
}

export function ShortcutFields({
  value = "enter",
  onChange,
  status = "",
  error = "",
}: {
  value?: string
  onChange?: (value: string) => void
  status?: string
  error?: string
}) {
  return (
    <>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-label">
            <h3 id="chatInputHeading">{uiText("发送快捷键")}</h3>
            <HelpTip id="chatInputHelp" label={uiText("发送快捷键")}>
              <span id="sendShortcutHelp">
                {value === "ctrlEnter" ? uiText("Enter 换行。") : uiText("Shift + Enter 换行。")}
              </span>{" "}
              {uiText("应用于所有项目和执行环境，包括已打开的对话。")}
            </HelpTip>
          </div>
        </div>
        <div className="settings-row-control">
          <fieldset
            id="sendShortcutGroup"
            className="settings-segments settings-compact-segments"
            aria-label={uiText("发送快捷键")}
          >
            {["enter", "ctrlEnter"].map((shortcut) => (
              <label key={shortcut}>
                <input
                  type="radio"
                  className="sr-only"
                  name="send_shortcut"
                  value={shortcut}
                  checked={value === shortcut}
                  readOnly={!onChange}
                  onChange={() => onChange?.(shortcut)}
                />
                <span>{shortcut === "enter" ? uiText("Enter 发送") : "Ctrl / ⌘ + Enter"}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </div>
      <p id="chatInputStatus" role="status" className="settings-help">
        {status}
      </p>
      <Feedback id="chatInputError" tone="error" className="mt-3" hidden={!error}>
        {error}
      </Feedback>
    </>
  )
}

function Preference({host, saves, kind}: Props & {kind: "appearance" | "chat-input"}) {
  const adapter = kind === "appearance" ? host.preferences.theme : host.preferences.shortcut
  const [value, setValue] = useState(() => adapter.current())
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const saved = useRef(value)
  const revision = useRef(0)
  useEffect(() => {
    const sync = () => setValue(adapter.current())
    const event = kind === "appearance" ? "yolu:appearance" : "yolu:chat-input"
    window.addEventListener(event, sync)
    return () => window.removeEventListener(event, sync)
  }, [adapter, kind])
  const change = async (choice: string) => {
    const observed = ++revision.current
    setValue(choice)
    setError("")
    setStatus(uiText("保存中…"))
    if (kind === "appearance") adapter.apply(choice)
    try {
      const result = await saves.enqueue(kind, () =>
        host.request<{color_theme?: string; send_shortcut?: string}>(`/api/settings/${kind}`, {
          method: "PUT",
          environment: "local",
          body: JSON.stringify(kind === "appearance" ? {color_theme: choice} : {send_shortcut: choice}),
        }),
      )
      saved.current = (kind === "appearance" ? result.color_theme : result.send_shortcut) || choice
      if (observed !== revision.current) return
      adapter.apply(saved.current)
      setValue(saved.current)
      setStatus(uiText(kind === "appearance" ? "已保存" : "已保存并应用"))
    } catch (cause) {
      if (observed !== revision.current) return
      adapter.apply(saved.current)
      setValue(saved.current)
      setStatus("")
      setError(message(cause))
    }
  }
  return (
    <form
      id={kind === "appearance" ? "appearanceForm" : "chatInputForm"}
      onSubmit={(event) => event.preventDefault()}
    >
      {kind === "appearance" ? (
        <AppearanceFields
          value={value}
          onChange={(choice) => {
            void change(choice)
          }}
          status={status}
          error={error}
        />
      ) : (
        <ShortcutFields
          value={value}
          onChange={(choice) => {
            void change(choice)
          }}
          status={status}
          error={error}
        />
      )}
    </form>
  )
}

function LanguagePreference({host}: Props) {
  const saved = host.preferences.language
  const [value, setValue] = useState(saved)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState("")
  const save = async () => {
    if (pending) return
    setPending(true)
    try {
      if (!(await host.preferences.flushDrafts()))
        throw new Error(uiText("草稿尚未保存，暂不重新加载。请保持页面打开后重试。"))
      await host.request("/api/settings/language", {
        method: "PUT",
        environment: "local",
        body: JSON.stringify({language: value}),
      })
      host.preferences.reload()
    } catch (cause) {
      setStatus(message(cause))
      setPending(false)
    }
  }
  return (
    <form
      id="languageForm"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <LanguageFields
        value={value}
        saved={saved}
        onChange={(next) => {
          setValue(next)
          setStatus("")
        }}
        onCancel={() => {
          setValue(saved)
          setStatus("")
        }}
        onSave={() => {
          void save()
        }}
        pending={pending}
        status={status}
      />
    </form>
  )
}

export function mountPreferences(host: SettingsHost, saves: Queue) {
  const entries = [
    ["#appearanceForm", <Preference key="appearance" host={host} saves={saves} kind="appearance" />],
    ["#chatInputForm", <Preference key="chat-input" host={host} saves={saves} kind="chat-input" />],
    ["#languageForm", <LanguagePreference key="language" host={host} saves={saves} />],
  ] as const
  const roots = entries.map(([selector, content]) => {
    const container = control(selector).parentElement
    if (!container) throw new Error(`Missing preference card: ${selector}`)
    const root = createRecoverableRoot(container)
    flushSync(() => root.render(content))
    return root
  })
  return () => {
    for (const root of roots) root.unmount()
  }
}
