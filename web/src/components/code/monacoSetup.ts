import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

const SCOPE_LIB = `
/** Output of the node that produced this token. */
declare const input: any;
/** Run variables. */
declare const vars: Record<string, any>;
/** Outputs of executed nodes: nodes.<id>.output */
declare const nodes: Record<string, { output: any }>;
/** Trigger payload. */
declare const trigger: any;
declare const run: { id: string; workflowId: string };
/** Current element inside a forEach body. */
declare const item: any;
/** Current index inside a forEach body. */
declare const index: number;
`

const js = monaco.typescript.javascriptDefaults
js.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ES2020,
  allowNonTsExtensions: true,
  checkJs: false,
  noLib: false,
})
js.setDiagnosticsOptions({ noSemanticValidation: true, diagnosticCodesToIgnore: [1108, 1375, 1378] })
js.addExtraLib(SCOPE_LIB, 'ts:flowpilot-scope.d.ts')

monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: false, trailingCommas: 'error' })

monaco.editor.defineTheme('fp-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editor.lineHighlightBackground': '#f5f5f7',
    'editorLineNumber.foreground': '#a1a1aa',
    'editorGutter.background': '#ffffff',
    'editor.selectionBackground': '#ddd6fe',
    focusBorder: '#00000000',
  },
})
monaco.editor.defineTheme('fp-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1b1b1f',
    'editor.lineHighlightBackground': '#232329',
    'editorLineNumber.foreground': '#52525b',
    'editorGutter.background': '#1b1b1f',
    'editor.selectionBackground': '#4c1d95aa',
    focusBorder: '#00000000',
  },
})

loader.config({ monaco })

export { monaco }
