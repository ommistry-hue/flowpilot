export function stringifyJson(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return JSON.stringify(value)
    }
  }
  return JSON.stringify(value, null, 2) ?? ''
}
