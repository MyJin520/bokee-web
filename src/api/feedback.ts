import { http } from './request'
import type {
  FeedbackListItem,
  FeedbackReply,
  FeedbackStatus,
  FeedbackSummary,
  FeedbackType,
  PageData,
} from '@/types'

/** 反馈列表筛选条件，空串表示不筛选 */
export interface FeedbackListQuery {
  type?: string
  status?: string
  keyword?: string
  page?: number
  pageSize?: number
}

/**
 * 提交反馈（所有登录用户）
 * 后端限制：同一用户 1 分钟 1 条、24 小时 20 条；相同 type+title+content 1 分钟内视为重复
 */
export function createFeedback(data: {
  type: FeedbackType
  title: string
  content: string
  images?: string[]
  pageUrl?: string
  contact?: string
}) {
  return http.post<string>('/pri/feedback/create', {
    type: data.type,
    title: data.title,
    content: data.content,
    images: data.images ?? [],
    pageUrl: data.pageUrl ?? '',
    contact: data.contact ?? '',
  })
}

/**
 * 反馈列表
 * 所有登录用户都能看到全部反馈（含他人 Bug）；pageUrl / contact 只有超管与提交者本人能拿到
 */
export function getFeedbackList(params: FeedbackListQuery = {}) {
  return http.post<PageData<FeedbackListItem>>('/pri/feedback/list', {
    type: params.type ?? '',
    status: params.status ?? '',
    keyword: params.keyword ?? '',
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 10,
  })
}

/** 我的反馈列表（含自己提交的 Bug） */
export function getMyFeedbackList(page = 1, pageSize = 10) {
  return http.post<PageData<FeedbackListItem>>('/pri/feedback/my_list', { page, pageSize })
}

/**
 * 参与讨论：在任意反馈下回复（所有登录用户）
 * parentId 非 0 表示回复某条已有回复，必须与 feedbackId 同属一条反馈
 * 后端限制：同一用户 1 分钟 10 条、24 小时 100 条
 */
export function createFeedbackReply(data: {
  feedbackId: number
  parentId?: number
  content: string
}) {
  return http.post<FeedbackReply>('/pri/feedback/reply_create', {
    feedbackId: data.feedbackId,
    parentId: data.parentId ?? 0,
    content: data.content,
  })
}

/** 反馈讨论区回复列表（按时间正序分页） */
export function getFeedbackReplies(feedbackId: number, page = 1, pageSize = 20) {
  return http.post<PageData<FeedbackReply>>('/pri/feedback/reply_list', {
    feedbackId,
    page,
    pageSize,
  })
}

/** 处理反馈（仅超管）：改状态 / 填官方答复，status 与 reply 至少传一个 */
export function updateFeedback(data: { id: number; status?: FeedbackStatus; reply?: string }) {
  return http.put<string>('/pri/feedback/update', data)
}

/** 删除反馈（仅超管，软删除） */
export function deleteFeedback(id: number) {
  return http.delete<string>('/pri/feedback/delete', { id })
}

/** 反馈统计（仅超管） */
export function getFeedbackSummary() {
  return http.get<FeedbackSummary>('/pri/feedback/summary')
}

/**
 * 导出反馈 CSV（仅超管）
 * 该接口返回文件流而非 JSON，不能走 http 封装，这里单独用 fetch 携带 Token
 * 后端错误仍以 JSON 返回，需要按 Content-Type 区分
 */
export async function exportFeedbackCsv(
  params: { type?: string; status?: string; keyword?: string } = {},
): Promise<Blob> {
  const query = new URLSearchParams()
  if (params.type) query.set('type', params.type)
  if (params.status) query.set('status', params.status)
  if (params.keyword?.trim()) query.set('keyword', params.keyword.trim())

  const token = localStorage.getItem('token')
  let response: Response
  try {
    response = await fetch(`/pri/feedback/export?${query.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch {
    throw new Error('网络连接异常，请检查后端服务是否可用')
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await response.json()) as { code?: number; msg?: string }
      throw new Error(body.msg || '导出失败，请稍后重试')
    } catch (error: unknown) {
      // 解析失败时给出统一提示，避免把解析异常抛给界面
      if (error instanceof SyntaxError) throw new Error('导出失败，请稍后重试')
      throw error
    }
  }
  if (!response.ok) throw new Error('导出失败，请稍后重试')
  return response.blob()
}
