import {Copy, Plus} from "lucide-react"
import {useEffect, useRef, useState} from "react"
import {createRoot} from "react-dom/client"
import {IconButton, PendingButton} from "@/shared/ui/actions/button"
import {Preview} from "@/shared/ui/data-display/code-preview"
import {StatusBadge, type StatusTone} from "@/shared/ui/data-display/status-badge"
import {DataTable} from "@/shared/ui/data-display/table"
import {EmptyState} from "@/shared/ui/feedback/empty-state"
import {LoadingState} from "@/shared/ui/feedback/loading-state"
import {Feedback} from "@/shared/ui/feedback/message"
import {Check} from "@/shared/ui/forms/check"
import {Field} from "@/shared/ui/forms/field"
import {setupHelpTips} from "@/shared/ui/help-tip"
import {ModalFooter, ModalHeader} from "@/shared/ui/layout/dialog"
import {SectionHeading} from "@/shared/ui/layout/section-heading"
import {Button} from "@/shared/ui/primitives/button"
import {Input} from "@/shared/ui/primitives/input"
import {NativeSelect, NativeSelectOption} from "@/shared/ui/primitives/native-select"
import {TableCell, TableRow} from "@/shared/ui/primitives/table"
import "@/shared/styles/base.css"
import "./catalog.css"

const tones: StatusTone[] = ["neutral", "success", "warning", "error", "accent"]

function Catalog() {
  const [dark, setDark] = useState(false)
  const [pending, setPending] = useState(false)
  const [path, setPath] = useState("")
  const [validate, setValidate] = useState(false)
  const [result, setResult] = useState("")
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => setupHelpTips(document.body), [])
  const close = () => dialog.current?.close()
  return (
    <main>
      <header className="catalog-heading">
        <div>
          <h1>Shared components</h1>
          <p>Live examples of the components used by browser and desktop features.</p>
        </div>
        <Button
          variant="outline"
          aria-pressed={dark}
          onClick={() => {
            const next = !dark
            setDark(next)
            document.documentElement.dataset.colorTheme = next ? "dark" : "mint"
            document.documentElement.dataset.colorScheme = next ? "dark" : "light"
          }}
        >
          Dark appearance
        </Button>
      </header>
      <section aria-labelledby="actions-title">
        <SectionHeading id="actions-title" title="Actions" level={2} />
        <div className="catalog-row">
          <Button onClick={() => setResult("Primary action completed")}>Primary action</Button>
          <Button variant="outline">Secondary action</Button>
          <Button disabled>Disabled</Button>
          <IconButton label="Copy example" onClick={() => setResult("Copy action completed")}>
            <Copy aria-hidden="true" />
          </IconButton>
          <PendingButton pending={pending} pendingLabel="Saving…" onClick={() => setPending(true)}>
            Save example
          </PendingButton>
          <Button variant="ghost" onClick={() => setPending(false)}>
            Reset pending
          </Button>
        </div>
        <p role="status" aria-live="polite">
          {result}
        </p>
      </section>
      <section aria-labelledby="form-title">
        <SectionHeading id="form-title" title="Form fields" level={2}>
          Labels, help and validation share stable control IDs.
        </SectionHeading>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            setValidate(true)
          }}
        >
          <Field id="example-name" label="Name" help="A directly nested input inherits its help association.">
            <Input id="example-name" />
          </Field>
          <Field
            id="example-path"
            label="Repository path"
            required
            help="Enter an absolute repository path."
            error={validate && !path.startsWith("/") ? "Use an absolute path starting with /." : undefined}
          >
            {(control) => (
              <div className="catalog-row">
                <Input {...control} value={path} onChange={(event) => setPath(event.target.value)} />
                <IconButton label="Choose directory" onClick={() => setPath("/workspace/example")}>
                  <Plus aria-hidden="true" />
                </IconButton>
              </div>
            )}
          </Field>
          <Field
            id="example-environment"
            label="Environment"
            help="The operation runs in this environment."
            helpDisplay="tooltip"
          >
            <NativeSelect id="example-environment">
              <NativeSelectOption>Local</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Check label="Remember selection" />
          <Button type="submit">Validate form</Button>
        </form>
      </section>
      <section aria-labelledby="feedback-title">
        <SectionHeading id="feedback-title" title="Feedback and states" level={2} />
        <Feedback>Changes saved. Informational feedback uses a polite status region.</Feedback>
        <Feedback tone="error">The operation failed. Error feedback uses an alert region.</Feedback>
        <LoadingState>Loading directories…</LoadingState>
        <div className="catalog-row">
          {tones.map((tone) => (
            <StatusBadge key={tone} tone={tone}>
              {tone}
            </StatusBadge>
          ))}
        </div>
        <EmptyState
          title="No results"
          description="Choose another filter or add a resource."
          actions={<Button variant="outline">Add a resource</Button>}
        />
      </section>
      <section aria-labelledby="data-title">
        <SectionHeading id="data-title" title="Data and dialogs" level={2} />
        <DataTable label="Example resources" headers={["Name", "Status"]}>
          <TableRow>
            <TableCell>Example</TableCell>
            <TableCell>Ready</TableCell>
          </TableRow>
        </DataTable>
        <Preview id="example-preview" title="Command preview" />
        <Button onClick={() => dialog.current?.showModal()}>Open example dialog</Button>
        <dialog ref={dialog} aria-labelledby="example-dialog-title">
          <ModalHeader
            id="example-dialog-title"
            title="Example dialog"
            closeLabel="Close example dialog"
            closeButton={{onClick: close}}
          />
          <p>The native dialog owns focus trapping, Escape and focus restoration.</p>
          <ModalFooter closeLabel="Cancel" closeButton={{onClick: close}}>
            <Button onClick={close}>Confirm</Button>
          </ModalFooter>
        </dialog>
      </section>
    </main>
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<Catalog />)
