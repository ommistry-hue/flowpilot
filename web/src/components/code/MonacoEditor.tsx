import Editor, { type OnMount } from '@monaco-editor/react'
import { useCallback, useState } from 'react'
import { useTheme } from '@/lib/theme'
import './monacoSetup'
import type { CodeEditorProps } from './CodeEditor'

export default function MonacoEditor({
  value,
  onChange,
  language,
  minHeight = 72,
  maxHeight = 360,
  height,
  readOnly,
  lineNumbers = false,
  placeholder,
  onSubmit,
}: CodeEditorProps) {
  const { resolved } = useTheme()
  const [autoHeight, setAutoHeight] = useState(minHeight)

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      if (!height) {
        const update = () => setAutoHeight(Math.min(maxHeight, Math.max(minHeight, editor.getContentHeight())))
        editor.onDidContentSizeChange(update)
        update()
      }
      if (onSubmit) {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onSubmit())
      }
    },
    [height, maxHeight, minHeight, onSubmit],
  )

  return (
    <div className="relative">
      <Editor
        height={height ?? autoHeight}
        language={language}
        value={value}
        theme={resolved === 'dark' ? 'fp-dark' : 'fp-light'}
        onChange={(v) => onChange?.(v ?? '')}
        onMount={handleMount}
        loading={<div className="h-full w-full animate-pulse bg-muted/50" />}
        options={{
          readOnly,
          minimap: { enabled: false },
          lineNumbers: lineNumbers ? 'on' : 'off',
          lineDecorationsWidth: lineNumbers ? 8 : 4,
          lineNumbersMinChars: 3,
          glyphMargin: false,
          folding: lineNumbers,
          fontSize: 12.5,
          fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
          fontLigatures: false,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: 'on',
          tabSize: 2,
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, alwaysConsumeMouseWheel: false },
          padding: { top: 8, bottom: 8 },
          fixedOverflowWidgets: true,
          contextmenu: false,
          stickyScroll: { enabled: false },
          suggest: { showWords: false },
        }}
      />
      {placeholder && !value && (
        <div className="pointer-events-none absolute top-2 left-3 font-mono text-[12.5px] text-muted-foreground/60">
          {placeholder}
        </div>
      )}
    </div>
  )
}
