import { http } from './request'
import type {
  FeedbackListItem,
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
 * 超管返回全部；普通用户仅返回非 Bug 反馈 + 自己提交的反馈
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

/** 处理反馈（仅超管）：改状态 / 回复，status 与 reply 至少传一个 */
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
