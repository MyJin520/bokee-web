import { http } from './request'
import type { PageData } from '@/types'
import type {
  IMConfig,
  IMConversation,
  IMMessageList,
  IMSendResult,
  IMUnread,
  IMWsTicket,
} from '@/types/im'

/** 打开（或创建）与目标用户的会话，陌生关系由后端判定额度 */
export function createConversation(targetId: number) {
  return http.post<IMConversation>('/pri/conversation/create', { targetId })
}

/** 会话列表（分页，按最后消息时间倒序，仅包含有过消息的会话） */
export function getConversations(page = 1, pageSize = 20) {
  return http.post<PageData<IMConversation>>('/pri/conversation/list', { page, pageSize })
}

/** 会话详情（刷新未读数与额度状态） */
export function getConversationInfo(id: number) {
  return http.get<IMConversation>('/pri/conversation/get_info', { id })
}

/**
 * 发送消息
 * clientMsgId 必须由调用方生成并在重试时复用，后端据此做幂等处理
 */
export function sendMessage(data: {
  targetId: number
  content: string
  clientMsgId: string
  msgType?: string
}) {
  return http.post<IMSendResult>('/pri/message/send', {
    targetId: data.targetId,
    msgType: data.msgType ?? 'text',
    content: data.content,
    clientMsgId: data.clientMsgId,
  })
}

/** 会话历史消息（倒序，lastId 传本页最旧消息 ID 可继续往前翻） */
export function getMessages(data: { conversationId: number; lastId?: number; pageSize?: number }) {
  return http.post<IMMessageList>('/pri/message/list', {
    conversationId: data.conversationId,
    lastId: data.lastId ?? 0,
    pageSize: data.pageSize ?? 20,
  })
}

/** 标记已读，lastReadId 为 0 表示读到最新 */
export function markMessagesRead(data: { conversationId: number; lastReadId?: number }) {
  return http.post<{ lastReadId: number }>('/pri/message/read', {
    conversationId: data.conversationId,
    lastReadId: data.lastReadId ?? 0,
  })
}

/** 未读汇总（总数 + 分会话未读） */
export function getUnread() {
  return http.get<IMUnread>('/pri/message/unread')
}

/** 离线消息同步（升序返回，afterId 传本地已收到的最大消息 ID） */
export function syncMessages(afterId = 0, limit = 200) {
  return http.get<IMMessageList>('/pri/message/sync', { afterId, limit })
}

/** 申请 WebSocket 一次性连接票据（30 秒内有效） */
export function getWsTicket() {
  return http.post<IMWsTicket>('/pri/message/ws_ticket')
}

/** 私信规则配置（长度上限等以后端配置为准） */
export function getImConfig() {
  return http.get<IMConfig>('/pri/message/config')
}
