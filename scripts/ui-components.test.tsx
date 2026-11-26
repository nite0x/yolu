import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {test} from "node:test"
import type {ReactNode} from "react"
import {renderToStaticMarkup} from "react-dom/server"
import {IconButton, PendingButton} from "../frontend/shared/ui/actions/button"
import {StatusBadge} from "../frontend/shared/ui/data-display/status-badge"
import {LoadingState} from "../frontend/shared/ui/feedback/loading-state"
import {Feedback} from "../frontend/shared/ui/feedback/message"
import {Check} from "../frontend/shared/ui/forms/check"
import {Field} from "../frontend/shared/ui/forms/field"
import {ModalFooter, ModalHeader} from "../frontend/shared/ui/layout/dialog"
import {Input} from "../frontend/shared/ui/primitives/input"
import {NativeSelect} from "../frontend/shared/ui/primitives/native-select"

const {JSDOM} = createRequire(import.meta.url)("jsdom")
function select<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  selector: K,
): HTMLElementTagNameMap[K]
function select(document: Document, selector: string): HTMLElement
function select(document: Document, selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector)
  assert(node, `Missing element: ${selector}`)
  return node
}
function markup(node: ReactNode): Document {
  return new JSDOM(renderToStaticMarkup(node)).window.document
}

test("fields associate native controls with labels, help and errors without dropping caller descriptions", () => {
  const document = markup(
    <Field id="name" label="Name" required help="Use a short name" error="Already taken">
      <Input id="name" aria-describedby="external name-help" />
    </Field>,
  )
  const input = select(document, "input")
  assert.equal(select(document, "label").htmlFor, input.id)
  assert.equal(input.getAttribute("aria-describedby"), "external name-help name-error")
  assert.equal(input.getAttribute("aria-invalid"), "true")
  assert.equal(input.required, true)
  assert.equal(select(document, "#name-error").getAttribute("role"), "alert")
})

test("wrapped controls receive the same association through the explicit control slot", () => {
  const document = markup(
    <Field id="path" label="Path" help="Absolute path" error="Required" required>
      {(control) => (
        <div>
          <Input {...control} />
          <button type="button">Browse</button>
        </div>
      )}
    </Field>,
  )
  assert.equal(select(document, "input").getAttribute("aria-describedby"), "path-help path-error")
  assert.equal(select(document, "input").required, true)
  assert.equal(select(document, "button").hasAttribute("required"), false)
})

test("selects retain tooltip help and existing invalid state without an error", () => {
  const document = markup(
    <Field id="environment" label="Environment" help="Execution host" helpDisplay="tooltip">
      <NativeSelect id="environment" aria-invalid="true" />
    </Field>,
  )
  assert.equal(select(document, "select").getAttribute("aria-describedby"), "environment-help")
  assert.equal(select(document, "select").getAttribute("aria-invalid"), "true")
  assert.equal(select(document, "#environment-help").getAttribute("role"), "tooltip")
})

test("pending buttons disable submission and expose progress while retaining the caller's submit contract", () => {
  const pending = markup(
    <PendingButton type="submit" name="decision" value="accept" pending pendingLabel="Sending">
      Accept
    </PendingButton>,
  ).querySelector("button")
  assert(pending)
  assert.equal(pending.disabled, true)
  assert.equal(pending.type, "submit")
  assert.equal(pending.name, "decision")
  assert.equal(pending.value, "accept")
  assert.equal(pending.getAttribute("aria-busy"), "true")
  assert.equal(pending.textContent, "Sending")
  const idle = markup(
    <PendingButton pendingLabel="Sending" disabled>
      Accept
    </PendingButton>,
  ).querySelector("button")
  assert(idle)
  assert.equal(idle.disabled, true)
  assert.equal(idle.type, "button")
  assert.equal(idle.textContent, "Accept")
})

test("icon buttons require a name and default to non-submitting actions", () => {
  const button = markup(
    <IconButton label="Close">
      <span aria-hidden="true">×</span>
    </IconButton>,
  ).querySelector("button")
  assert(button)
  assert.equal(button.type, "button")
  assert.equal(button.getAttribute("aria-label"), "Close")
  assert.equal(button.title, "Close")
})

test("feedback distinguishes informational updates from errors and preserves native hidden state", () => {
  const document = markup(
    <>
      <Feedback id="info">Saved</Feedback>
      <Feedback id="error" tone="error" hidden>
        Failed
      </Feedback>
      <LoadingState>Loading</LoadingState>
    </>,
  )
  assert.equal(select(document, "#info").getAttribute("role"), "status")
  assert.equal(select(document, "#error").getAttribute("role"), "alert")
  assert.equal(select(document, "#error").hidden, true)
  assert.equal(document.querySelectorAll('[role="status"]').length, 2)
})

test("dialog presentations preserve native controller selectors and explicit close overrides", () => {
  const document = markup(
    <>
      <ModalHeader
        id="title"
        title="Command"
        closeLabel="Close command"
        closeButton={{id: "closeCommand", autoFocus: true}}
      />
      <ModalFooter closeLabel="Dismiss">
        <button type="submit">Save</button>
      </ModalFooter>
    </>,
  )
  assert.equal(select(document, "h2").id, "title")
  assert.equal(select(document, "#closeCommand").getAttribute("aria-label"), "Close command")
  assert.equal(document.querySelectorAll("button.close-dialog").length, 2)
  assert.equal(select(document, ".dialog-footer .close-dialog").textContent, "Dismiss")
})

test("status badges display caller-owned labels", () => {
  const document = markup(<StatusBadge tone="warning">Needs attention</StatusBadge>)
  assert.equal(document.body.textContent, "Needs attention")
})

test("checkboxes retain their label and controlled state with caller classes", () => {
  const document = markup(<Check label="Remember" id="remember" checked readOnly className="custom-check" />)
  const input = select(document, "input")
  assert.equal(input.type, "checkbox")
  assert.equal(input.checked, true)
  assert.equal(select(document, "label").textContent, "Remember")
  assert.equal(input.classList.contains("custom-check"), true)
})
