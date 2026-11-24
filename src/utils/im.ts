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

/** 文本片段：纯文本或可点击链接（链接由前端白名单协议识别，不做 HTML 转义渲染） */
export interface TextSegment {
  kind: 'text' | 'link'
  text: string
  url?: string
}

const LINK_RE = /\bhttps?:\/\/[^\s<>"'（）()【】]+/gi
/** 链接结尾可能粘连的标点，渲染时剥离 */
const TRAILING_PUNCT = /[.,!?，。！？、；：]+$/

/** 把纯文本按 http/https 链接拆成片段数组，供模板分别渲染文本与 <a> 标签 */
export function splitLinkSegments(text: string): TextSegment[] {
  const source = text ?? ''
  if (!source) return []
  const segments: TextSegment[] = []
  let lastIndex = 0
  LINK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK_RE.exec(source)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', text: source.slice(lastIndex, match.index) })
    }
    const raw = match[0]
    const url = raw.replace(TRAILING_PUNCT, '')
    segments.push({ kind: 'link', text: url, url })
    lastIndex = match.index + raw.length
    LINK_RE.lastIndex = lastIndex
  }
  if (lastIndex < source.length) {
    segments.push({ kind: 'text', text: source.slice(lastIndex) })
  }
  return segments
}

/** 会话列表 / 引用块使用的消息摘要文本 */
export function messageBriefPreview(message: {
  msgType: string
  content: string
  recalled: boolean
}): string {
  if (message.recalled) return '消息已撤回'
  if (message.msgType === 'image') return '[图片]'
  return (message.content || '').replace(/\s+/g, ' ')
}

/** 判断消息是否仍在可撤回时间窗口内（后端最终兜底校验） */
export function canRecallMessage(createdAt: string, windowMin: number): boolean {
  const time = Date.parse(createdAt)
  if (!time || Number.isNaN(time)) return false
  const window = (windowMin > 0 ? windowMin : 3) * 60 * 1000
  return Date.now() - time <= window
}
