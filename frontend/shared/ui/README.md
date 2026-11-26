# Shared UI foundations

Browser and desktop features use the same components. Start with an existing
primitive, then use a composed component when it supplies a repeated behavior.
Import its module directly; there is no catch-all export barrel.

| Module | Exports | Contract |
| --- | --- | --- |
| `primitives/` | `Button`, `Input`, `Textarea`, `NativeSelect`, `Card`, `Table`, Radix dialogs | Variants, sizes, focus and disabled styling |
| `actions/button` | `Action`, `IconButton`, `PendingButton` | Controller attributes, required icon labels, controlled pending state |
| `forms/field` | `Field`, `FieldControlProps` | Stable labels, help, required state and validation errors |
| `forms/check` | `Check` | Labeled native checkbox |
| `feedback/message` | `Feedback` | Informational `status` and error `alert` announcements |
| `feedback/loading-state` | `LoadingState` | Named progress and a reduced-motion-aware decorative spinner |
| `feedback/empty-state` | `EmptyState` | Caller-owned header and action slots |
| `feedback/render-boundary` | `RenderBoundary` | Pane-local render failures and explicit retry |
| `feedback/root` | `createRecoverableRoot` | React root with the standard recovery boundary |
| `layout/dialog` | `ModalHeader`, `ModalFooter` | Dialog presentation and close controls |
| `layout/section-heading` | `SectionHeading` | Named sections, optional help content and trailing actions |
| `data-display/status-badge` | `StatusBadge`, `StatusTone` | Caller labels with neutral/success/warning/error/accent tones |
| `data-display/table` | `DataTable` | Named table, unique column headings and caller-owned rows |
| `data-display/code-preview` | `Preview` | Controller-owned code output target |

List controls, pane surfaces, help tips and resource icons keep their existing
purpose-specific modules. Project labels, directory actions and conversation
state belong to their entity or feature.

## Fields and validation

`id` identifies the control, not the wrapper. A direct child with the same ID
receives help/error associations and the field's required state. Existing
`aria-describedby` IDs and invalid state are preserved. Only pass an error while
validation fails. Associations use `${id}-label`, `${id}-help` and `${id}-error`.

```tsx
import {Field} from "@/shared/ui/forms/field"
import {Input} from "@/shared/ui/primitives/input"

<Field id="name" label={nameLabel} help={hint} error={error} required>
  <Input id="name" value={name} onChange={updateName} />
</Field>
```

Use the explicit control slot for an input inside another element or custom
component. Spread its props onto the actual control and append any additional
description IDs. Fields do not traverse opaque components.

```tsx
<Field id="path" label={pathLabel} help={pathHelp} required>
  {control => (
    <div className="flex gap-2">
      <Input {...control} value={path} onChange={updatePath} />
      <IconButton label={browseLabel} onClick={chooseDirectory}>
        <Folder aria-hidden="true" />
      </IconButton>
    </div>
  )}
</Field>
```

Use `Check` for a boolean, or native `fieldset`/`legend` for related choices.
Features own validation and requests. Disable inactive required controls when
hiding conditional sections. Localize product labels through `uiText`.

## Actions, feedback and dialogs

`IconButton` requires a label and defaults to a non-submitting ghost button. Keep
icons decorative. Reuse the existing button sizes and semantic theme tokens.

`PendingButton` accepts `pending`, `pendingLabel` and `disabled`. It disables the
control and exposes `aria-busy` while pending. It defaults to `type="button"`;
forms explicitly select `type="submit"`. The caller owns request lifetime, errors
and retry. `Action` preserves native `data-action` and `data-id` contracts.

`Feedback` defaults to a polite status region; `tone="error"` selects an alert.
Keep native `hidden` on controller placeholders. Map business statuses to
`StatusTone` inside the feature, and always provide the badge's text label.

`ModalHeader` and `ModalFooter` provide presentation. The native `<dialog>` or
Radix dialog owner traps focus, handles Escape and restores focus. Associate the
heading using `aria-labelledby`. Native controllers use `.close-dialog`; React
owners supply `closeButton.onClick`. Customize `closeLabel` or `closeButton` for
labels, IDs, focus and handlers. `SectionHeading` accepts optional tooltip help
as children. `setupHelpTips(root)` returns a cleanup function for React effects
and also cleans up at page hide.

## Preview and checks

```bash
npm run ui:dev             # http://127.0.0.1:5174/frontend/dev/
npm run ui:build           # Independent component catalog
npm run ui:format          # Formatting and safe lint/import fixes
npm run ui:check           # Formatting, lint and behavior tests
npm run ui:test:browser    # Chromium interactions and axe WCAG checks
npm run check             # API, architecture and strict TypeScript too
```

Biome checks every frontend TypeScript/TSX source, the catalog and component tests. Existing source formatting is retained outside the formatted foundations and settings scopes.
Registry source is not reformatted wholesale. TypeScript and architecture checks
cover the whole frontend. Primitives cannot import composed UI; production code
cannot import the developer catalog. CI builds the catalog and checks keyboard
dialogs, validation, pending actions, light/dark contrast and narrow layouts.
The catalog has a separate build and is not embedded in the application.

Extend a component when several real callers need its behavior. Migrate those
callers and test meaningful behavior or accessibility contracts. Preserve native
IDs, data attributes, storage keys and browser adapter names. Compare affected
browser and desktop pages at the same viewport sizes.
