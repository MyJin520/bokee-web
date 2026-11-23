/** 私信时间展示：会话列表用相对时间，消息流用时分 + 日期分隔 */

function toDate(value?: string | number | Date): Date | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  // 后端零值时间（0001-01-01）视为无时间
  if (date.getFullYear() < 1970) return null
  return date
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 会话列表时间：今天显示时分，昨天显示「昨天」，更早显示月日 */
export function formatConversationTime(value?: string): string {
  const date = toDate(value)
  if (!date) return ''
  const now = new Date()
  if (isSameDay(date, now)) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return '昨天'
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

/** 气泡时间：仅时分 */
export function formatMessageTime(value?: string): string {
  const date = toDate(value)
  if (!date) return ''
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 日期分隔标签：今天 / 昨天 / 月日 / 年月日 */
export function formatDayLabel(value?: string): string {
  const date = toDate(value)
  if (!date) return ''
  const now = new Date()
  if (isSameDay(date, now)) return '今天'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return '昨天'
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/** 两条消息是否跨天，用于插入日期分隔 */
export function isDifferentDay(prev?: string, next?: string): boolean {
  const a = toDate(prev)
  const b = toDate(next)
  if (!a || !b) return false
  return !isSameDay(a, b)
}
