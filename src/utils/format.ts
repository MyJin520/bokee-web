/** 日期 / 数字展示工具 */

export function formatDate(value: string | Date, withTime = false): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(
    'zh-CN',
    withTime
      ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'long', day: 'numeric' },
  )
}

export function formatShortDate(value: string | Date): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function formatNumber(value: number | null | undefined): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '0'
}

/** 取标题首字符作为无封面时的占位 */
export function initialOf(text: string): string {
  return (text || '?').trim().slice(0, 1).toUpperCase()
}
