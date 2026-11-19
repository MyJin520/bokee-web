/** 反馈模块共用的枚举文案：中心页、提交弹窗、处理弹窗统一从这里取，避免多处维护 */

import type { FeedbackStatus, FeedbackType } from '@/types'

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug: '缺陷 Bug',
  optimize: '待优化',
  feature: '新功能',
  other: '其他',
}

export const FEEDBACK_TYPE_HINTS: Record<FeedbackType, string> = {
  bug: '报错、白屏、功能不可用',
  optimize: '流程不顺、交互可改进',
  feature: '希望增加的能力',
  other: '不属于以上类别',
}

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已解决',
  ignored: '不处理',
}

export const FEEDBACK_STATUS_HINTS: Record<FeedbackStatus, string> = {
  pending: '已收到，排在队列里',
  processing: '正在排查或开发',
  resolved: '已修复 / 已上线',
  ignored: '已评估，不做改动',
}

/** 枚举顺序：同时决定筛选下拉、类型卡片、状态卡片的展示顺序 */
export const FEEDBACK_TYPE_ORDER: FeedbackType[] = ['bug', 'optimize', 'feature', 'other']

export const FEEDBACK_STATUS_ORDER: FeedbackStatus[] = [
  'pending',
  'processing',
  'resolved',
  'ignored',
]
