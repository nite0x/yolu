import {uiText} from "@/shared/i18n"
import type {DefaultValues, Model, ModelOptions, SettingsHost} from "../model/contracts"
import type {createSettingsSaveQueue} from "../runtime/save-queue"
import {control as $} from "./controls"

type Segment = {value: string; label: string; danger?: boolean; unavailable?: boolean}
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c] || c,
  )

export function createAgentSettingsController(
  host: SettingsHost,
  saves: ReturnType<typeof createSettingsSaveQueue>,
) {
  const enqueueSettingsSave = saves.enqueue
  const settingsSaveQueues = {get: saves.wait}
  let titleSettingsEnvironment: string | null = null
  let titleSettingsLoading = false
  let titleSettingsRevision = 0
  let titleSaveRevision = 0
  let conversationDefaultsEnvironment: string | null = null
  let conversationDefaultsRevision = 0
  let conversationDefaultsLoading = false
  let conversationDefaultModels: Model[] = []
  const conversationDefaultsSaveRevisions = new Map<string, number>()
  const conversationDefaultsDrafts = new Map<string, {settings: DefaultValues; error?: string}>()
  function syncModelsReloadButton() {
    const button = $("#conversationDefaultsReload")
    if (!button) return
    const loading = conversationDefaultsLoading || titleSettingsLoading
    button.disabled = !host.context().loaded || loading
    button.dataset.loading = loading ? "true" : "false"
  }

  async function loadSessionTitleSettings() {
    const environment = host.context().environment
    const revision = ++titleSettingsRevision
    titleSettingsEnvironment = environment
    titleSettingsLoading = true
    $("#sessionTitleFields").disabled = true
    syncModelsReloadButton()
    $("#sessionTitleError").hidden = true
    if ($("#sessionTitleStatus")) $("#sessionTitleStatus").textContent = ""
    try {
      await settingsSaveQueues.get(JSON.stringify([environment, "title"]))?.catch(() => {})
      const result = await host.request<ModelOptions>("/api/settings/session-title", {environment})
      if (environment !== host.context().environment || revision !== titleSettingsRevision) return
      const model = result.settings.model || ""
      const models = result.models || []
      $("#sessionTitleModel").innerHTML =
        uiText('<option value="">跟随正文模型</option>') +
        (model && !models.some((m) => m.model === model)
          ? uiText('<option value="{0}">{1}（当前不可用）</option>', esc(model), esc(model))
          : "") +
        models
          .map((m) => `<option value="${esc(m.model)}">${esc(m.displayName || m.model)}</option>`)
          .join("")
      $("#sessionTitleModel").value = model
      $("#sessionTitleFields").disabled = false
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (environment !== host.context().environment || revision !== titleSettingsRevision) return
      $("#sessionTitleError").textContent = error.message
      $("#sessionTitleError").hidden = false
    } finally {
      if (environment === host.context().environment && revision === titleSettingsRevision) {
        titleSettingsLoading = false
        syncModelsReloadButton()
      }
    }
  }

  async function saveSessionTitleModel() {
    if ($("#sessionTitleFields").disabled) return
    const environment = host.context().environment
    const model = $("#sessionTitleModel").value
    const revision = ++titleSaveRevision
    const loadRev = titleSettingsRevision
    $("#sessionTitleError").hidden = true
    if ($("#sessionTitleStatus")) $("#sessionTitleStatus").textContent = uiText("保存中…")
    try {
      await enqueueSettingsSave(JSON.stringify([environment, "title"]), () =>
        host.request<ModelOptions>("/api/settings/session-title", {
          method: "PUT",
          environment,
          body: JSON.stringify({model}),
        }),
      )
      if (
        environment !== host.context().environment ||
        revision !== titleSaveRevision ||
        loadRev !== titleSettingsRevision
      )
        return
      if ($("#sessionTitleStatus")) $("#sessionTitleStatus").textContent = uiText("已保存")
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (
        environment !== host.context().environment ||
        revision !== titleSaveRevision ||
        loadRev !== titleSettingsRevision
      )
        return
      if ($("#sessionTitleStatus")) $("#sessionTitleStatus").textContent = ""
      $("#sessionTitleError").textContent = error.message
      $("#sessionTitleError").hidden = false
    }
  }

  $("#sessionTitleModel").addEventListener("change", () => {
    void saveSessionTitleModel()
  })
  $("#sessionTitleForm").addEventListener("submit", (event) => {
    event.preventDefault()
    void saveSessionTitleModel()
  })

  function setConversationDefaultOptions(
    select: HTMLSelectElement,
    defaultLabel: string,
    options: HTMLOptionElement[],
    value: string,
    unavailableLabel?: string,
  ) {
    const selected = options.some((option) => option.value === value)
    if (value && !selected && unavailableLabel)
      options.unshift(new Option(uiText(unavailableLabel, value), value))
    select.replaceChildren(new Option(defaultLabel, ""), ...options)
    select.value = selected || unavailableLabel ? value : ""
  }

  let defaultAgentEnvironment: string | null = null
  let defaultAgentRevision = 0
  let defaultAgentSaved = "codex"
  async function loadDefaultAgent() {
    const environment = host.context().environment
    const revision = ++defaultAgentRevision
    defaultAgentEnvironment = environment
    $("#defaultAgentSelect").disabled = true
    $("#defaultAgentStatus").textContent = ""
    $("#defaultAgentError").hidden = true
    $("#defaultAgentRetry").hidden = true
    try {
      await settingsSaveQueues.get(JSON.stringify([environment, "default-agent"]))?.catch(() => {})
      const result = await host.request<{provider: string}>("/api/settings/default-agent", {environment})
      if (environment !== host.context().environment || revision !== defaultAgentRevision) return
      defaultAgentSaved =
        result.provider === "agy" || result.provider === "cursor" ? result.provider : "codex"
      $("#defaultAgentSelect").value = defaultAgentSaved
      $("#defaultAgentSelect").disabled = false
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (environment !== host.context().environment || revision !== defaultAgentRevision) return
      $("#defaultAgentError").textContent = error.message
      $("#defaultAgentError").hidden = false
      $("#defaultAgentRetry").hidden = false
    }
  }
  async function saveDefaultAgent() {
    if ($("#defaultAgentSelect").disabled) {
      void loadDefaultAgent()
      return
    }
    const environment = host.context().environment
    const revision = ++defaultAgentRevision
    const provider = $("#defaultAgentSelect").value
    $("#defaultAgentStatus").textContent = uiText("保存中…")
    $("#defaultAgentError").hidden = true
    $("#defaultAgentRetry").hidden = true
    try {
      await enqueueSettingsSave(JSON.stringify([environment, "default-agent"]), () =>
        host.request<{provider: string}>("/api/settings/default-agent", {
          method: "PUT",
          environment,
          body: JSON.stringify({provider}),
        }),
      )
      if (environment !== host.context().environment || revision !== defaultAgentRevision) return
      defaultAgentSaved = provider
      $("#defaultAgentStatus").textContent = uiText("已保存")
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (environment !== host.context().environment || revision !== defaultAgentRevision) return
      $("#defaultAgentStatus").textContent = ""
      $("#defaultAgentError").textContent = error.message
      $("#defaultAgentError").hidden = false
      $("#defaultAgentRetry").hidden = false
    }
  }
  $("#defaultAgentSelect").addEventListener("change", () => {
    void saveDefaultAgent()
  })
  $("#defaultAgentForm").addEventListener("submit", (event) => {
    event.preventDefault()
    void saveDefaultAgent()
  })
  $("#defaultAgentRetry").addEventListener("click", () => {
    void saveDefaultAgent()
  })

  function selectedProvider() {
    return (
      document.querySelector<HTMLInputElement>(
        '#conversationDefaultProviderGroup input[name="conversation_default_provider"]:checked',
      )?.value || "codex"
    )
  }

  function selectedSegmentValue(containerId: string, inputName: string) {
    return (
      document.querySelector<HTMLInputElement>(`#${containerId} input[name="${inputName}"]:checked`)?.value ??
      ""
    )
  }

  function selectedEffort() {
    return $("#conversationDefaultEffortDropdown").hidden
      ? selectedSegmentValue("conversationDefaultEffort", "conversation_default_effort")
      : $("#conversationDefaultEffortSelect").value
  }

  function renderSegmentOptions(
    container: HTMLElement,
    inputName: string,
    items: Segment[],
    value: string,
    unavailableLabel?: string,
  ) {
    const list = [...items]
    const matched = list.some((item) => item.value === value)
    if (value && !matched && unavailableLabel) {
      list.splice(1, 0, {value, label: uiText(unavailableLabel, value), unavailable: true})
    }
    const activeValue = matched || (value && unavailableLabel) ? value : ""
    const onlyDefault = list.length <= 1
    container.dataset.disabled = onlyDefault ? "true" : "false"
    const nodes = list.map((item) => {
      const label = document.createElement("label")
      if (item.danger) label.dataset.danger = "true"
      if (item.unavailable) label.dataset.unavailable = "true"
      const input = document.createElement("input")
      input.type = "radio"
      input.className = "sr-only"
      input.name = inputName
      input.value = item.value
      input.checked = item.value === activeValue
      if (onlyDefault) input.disabled = true
      const text = document.createElement("span")
      text.textContent = item.label
      label.append(input, text)
      return label
    })
    container.replaceChildren(...nodes)
  }

  function updatePermissionHelp(provider: string, permission: string) {
    const help = $("#conversationDefaultPermissionHelp")
    if (!help) return
    const choice = host.choices.permissionChoices(provider).find((choice) => choice.value === permission)
    help.textContent =
      choice?.description || uiText("创建对话时由引擎配置和目录授权决定，可在对话中查看实际权限。")
    help.dataset.danger = permission === "full" ? "true" : "false"
  }

  function renderConversationModelOptions(
    provider: string,
    effort: string,
    speed: string,
    unavailableLabel?: string,
  ) {
    const {findChatModel, effortLabel, serviceTierLabel} = host.choices
    const model = findChatModel(conversationDefaultModels, $("#conversationDefaultModel").value)
    const effortOptions = [
      ...new Set(model?.supportedReasoningEfforts?.map((item) => item.reasoningEffort).filter(Boolean)),
    ]
    const tiers = new Map(
      (model?.serviceTiers || []).filter((tier) => tier.id).map((tier) => [tier.id, tier]),
    )
    const effortContainer = $("#conversationDefaultEffort")
    const speedSelect = $("#conversationDefaultSpeed")
    const effortItems = effortOptions.length
      ? [
          {value: "", label: uiText("默认")},
          ...effortOptions.map((value) => ({value, label: effortLabel(value)})),
        ]
      : [{value: "", label: uiText("使用模型默认强度")}]
    renderSegmentOptions(
      effortContainer,
      "conversation_default_effort",
      effortItems,
      effort,
      unavailableLabel,
    )
    const effortSelect = $("#conversationDefaultEffortSelect")
    const dropdown = effortContainer.querySelectorAll("input").length > 5
    effortContainer.hidden = dropdown
    $("#conversationDefaultEffortDropdown").hidden = !dropdown
    effortSelect.disabled = !dropdown
    if (dropdown) {
      effortSelect.replaceChildren(
        ...[...effortContainer.querySelectorAll("input")].map(
          (input) => new Option(input.parentElement?.textContent || "", input.value),
        ),
      )
      effortSelect.value = selectedSegmentValue("conversationDefaultEffort", "conversation_default_effort")
    }
    if (provider !== "codex") {
      speedSelect.replaceChildren(
        new Option(
          provider === "cursor"
            ? uiText("Cursor 由模型决定响应速度")
            : uiText("Antigravity 由模型决定响应速度"),
          "",
        ),
      )
    } else {
      setConversationDefaultOptions(
        speedSelect,
        uiText("沿用 Codex 默认速度"),
        [...tiers.values()].map((tier) => new Option(serviceTierLabel(tier), tier.id)),
        speed,
        unavailableLabel,
      )
    }
    speedSelect.disabled = speedSelect.options.length === 1
  }

  function conversationDefaultsPath(provider: string, reload = false) {
    return (
      "/api/settings/conversation-defaults" +
      (provider !== "codex" ? `?provider=${provider}${reload ? "&refresh=1" : ""}` : "")
    )
  }

  function conversationDefaultValues() {
    return {
      model: $("#conversationDefaultModel").value,
      effort: selectedEffort(),
      serviceTier: $("#conversationDefaultSpeed").value,
      permission: selectedSegmentValue("conversationDefaultPermission", "conversation_default_permission"),
    }
  }

  function setConversationDefaultsStatus(text: string, muted = false) {
    const status = $("#conversationDefaultsStatus")
    if (!status) return
    status.textContent = text
    status.dataset.state = muted ? "muted" : ""
  }

  async function loadConversationDefaults(reload = false) {
    const environment = host.context().environment
    const provider = selectedProvider()
    const revision = ++conversationDefaultsRevision
    conversationDefaultsEnvironment = environment
    conversationDefaultsLoading = true
    $("#conversationDefaultProviderGroup").disabled = false
    $("#conversationDefaultsFields").disabled = true
    syncModelsReloadButton()
    $("#conversationDefaultsError").hidden = true
    $("#conversationDefaultsRetry").hidden = true
    setConversationDefaultsStatus(uiText("正在读取…"), true)
    try {
      const key = JSON.stringify([environment, provider])
      await settingsSaveQueues.get(key)?.catch(() => {})
      if (environment !== host.context().environment || revision !== conversationDefaultsRevision) return
      const result = await host.request<ModelOptions>(conversationDefaultsPath(provider, reload), {
        environment,
      })
      if (environment !== host.context().environment || revision !== conversationDefaultsRevision) return
      conversationDefaultModels = result.models || []
      const unavailableLabel = result.models_error ? "{0}（未核对）" : "{0}（当前不可用）"
      const draft = conversationDefaultsDrafts.get(key)
      const settings = draft?.settings || result.settings || {}
      const models = conversationDefaultModels.map(
        (model) => new Option(model.displayName || model.model, model.model),
      )
      setConversationDefaultOptions(
        $("#conversationDefaultModel"),
        provider === "cursor"
          ? uiText("沿用 Cursor 默认模型")
          : provider === "agy"
            ? uiText("沿用 Antigravity 默认模型")
            : uiText("沿用 Codex 默认模型"),
        models,
        settings.model || "",
        unavailableLabel,
      )
      renderConversationModelOptions(
        provider,
        settings.effort || "",
        settings.serviceTier || "",
        unavailableLabel,
      )
      const permissions = [
        {value: "", label: uiText("沿用默认")},
        ...host.choices
          .permissionChoices(provider)
          .map((choice) => ({value: choice.value, label: choice.label, danger: !!choice.danger})),
      ]
      renderSegmentOptions(
        $("#conversationDefaultPermission"),
        "conversation_default_permission",
        permissions,
        settings.permission || "",
        unavailableLabel,
      )
      updatePermissionHelp(
        provider,
        selectedSegmentValue("conversationDefaultPermission", "conversation_default_permission"),
      )
      setConversationDefaultsStatus(result.models_error ? uiText(result.models_error) : "", true)
      if (draft?.error) {
        $("#conversationDefaultsError").textContent = draft.error
        $("#conversationDefaultsError").hidden = false
        $("#conversationDefaultsRetry").hidden = false
      }
      $("#conversationDefaultsFields").disabled = result.available === false
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (environment !== host.context().environment || revision !== conversationDefaultsRevision) return
      setConversationDefaultsStatus("")
      $("#conversationDefaultsError").textContent = error.message
      $("#conversationDefaultsError").hidden = false
    } finally {
      if (environment === host.context().environment && revision === conversationDefaultsRevision) {
        conversationDefaultsLoading = false
        syncModelsReloadButton()
      }
    }
  }

  async function saveConversationDefaults() {
    if ($("#conversationDefaultsFields").disabled) return
    const environment = host.context().environment
    const provider = selectedProvider()
    const key = JSON.stringify([environment, provider])
    const saveRev = (conversationDefaultsSaveRevisions.get(key) || 0) + 1
    conversationDefaultsSaveRevisions.set(key, saveRev)
    const loadRev = conversationDefaultsRevision
    const settings = conversationDefaultValues()
    const draft: {settings: DefaultValues; error?: string} = {settings}
    conversationDefaultsDrafts.set(key, draft)
    $("#conversationDefaultsError").hidden = true
    $("#conversationDefaultsRetry").hidden = true
    setConversationDefaultsStatus(uiText("保存中…"), true)
    try {
      await enqueueSettingsSave(key, () =>
        host.request<ModelOptions>(conversationDefaultsPath(provider), {
          method: "PUT",
          environment,
          body: JSON.stringify(settings),
        }),
      )
      if (conversationDefaultsDrafts.get(key) === draft) conversationDefaultsDrafts.delete(key)
      if (
        environment === host.context().environment &&
        provider === selectedProvider() &&
        loadRev === conversationDefaultsRevision &&
        conversationDefaultsSaveRevisions.get(key) === saveRev
      ) {
        setConversationDefaultsStatus(uiText("已保存"))
      }
      host.broadcastDefaults(environment, provider)
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      draft.error = error.message
      if (
        environment !== host.context().environment ||
        provider !== selectedProvider() ||
        loadRev !== conversationDefaultsRevision ||
        conversationDefaultsSaveRevisions.get(key) !== saveRev
      )
        return
      setConversationDefaultsStatus("")
      $("#conversationDefaultsError").textContent = error.message
      $("#conversationDefaultsError").hidden = false
      $("#conversationDefaultsRetry").hidden = false
    }
  }

  $("#conversationDefaultProviderGroup").addEventListener("change", () => {
    if (host.context().loaded) void loadConversationDefaults()
  })
  $("#conversationDefaultModel").addEventListener("change", () => {
    const provider = selectedProvider()
    renderConversationModelOptions(provider, selectedEffort(), $("#conversationDefaultSpeed").value)
  })
  $("#conversationDefaultsRetry").addEventListener("click", () => {
    void saveConversationDefaults()
  })
  $("#conversationDefaultsFields").addEventListener("change", () => {
    if ($("#conversationDefaultsFields").disabled) return
    const provider = selectedProvider()
    updatePermissionHelp(
      provider,
      selectedSegmentValue("conversationDefaultPermission", "conversation_default_permission"),
    )
    void saveConversationDefaults()
  })
  $("#conversationDefaultsReload").addEventListener("click", () => {
    if (!host.context().loaded) return
    if (!conversationDefaultsLoading) void loadConversationDefaults(true)
    if (!titleSettingsLoading) void loadSessionTitleSettings()
  })
  $("#conversationDefaultsForm").addEventListener("submit", (event) => {
    event.preventDefault()
    void saveConversationDefaults()
  })

  return {
    refresh() {
      if (!host.context().loaded) {
        defaultAgentEnvironment = null
        defaultAgentRevision++
        $("#defaultAgentSelect").disabled = true
        titleSettingsEnvironment = null
        titleSettingsRevision++
        titleSettingsLoading = false
        conversationDefaultsEnvironment = null
        conversationDefaultsRevision++
        conversationDefaultsLoading = false
        $("#conversationDefaultProviderGroup").disabled = true
        $("#conversationDefaultsFields").disabled = true
        $("#sessionTitleFields").disabled = true
      } else if (host.context().view === "settings") {
        if (defaultAgentEnvironment !== host.context().environment) void loadDefaultAgent()
        if (titleSettingsEnvironment !== host.context().environment) void loadSessionTitleSettings()
        if (conversationDefaultsEnvironment !== host.context().environment) void loadConversationDefaults()
      }
      syncModelsReloadButton()
    },
  }
}
