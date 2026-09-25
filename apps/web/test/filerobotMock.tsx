import type { ReactElement } from 'react'

// The library's own values, mirrored. PhotoEditor reads `TABS` at module scope to build
// its `tabsIds` and `TOOLS.TEXT` in its render body, so a mock without either throws
// rather than merely rendering nothing.
export const TABS = { FINETUNE: 'Finetune', FILTERS: 'Filters', ADJUST: 'Adjust', WATERMARK: 'Watermark', ANNOTATE: 'Annotate', RESIZE: 'Resize' }
export const TOOLS = { TEXT: 'Text', PEN: 'Pen', CROP: 'Crop' }

// Every render of the editor is recorded here, so a test can assert the config the
// component handed it (`editorProps.at(-1)`). Reset it in the test file's `beforeEach`.
export const editorProps: any[] = []

// What the mocked editor does when it renders. Unset is the common case: record the
// props and render nothing. Tests that need more set these at module scope, before the
// first render. Vitest isolates module state per test file, so these do not leak.
export const behavior: {
  /** Reproduce the editor that saves the moment it mounts — the edit flow's mock. */
  save?: (props: any) => void
  /** Render the rendition as an attribute: the two Edit actions differ only in it. */
  probeSource?: boolean
} = {}

export default function FilerobotImageEditor(props: any): ReactElement | null {
  editorProps.push(props)
  behavior.save?.(props)
  if (behavior.probeSource) return <div data-testid="fil-editor" data-source={props.source} />
  return null
}
