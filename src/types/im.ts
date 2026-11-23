/** ============ 私信（IM） ============ */

/** 会话对端用户简要信息 */
export interface IMUserBrief {
  id: number
  name: string
  avatar: string
}

/**
 * 会话列表里的最后一条消息摘要
 * 注意：后端字段为 `createAt`（不是 createdAt），与消息列表项的 `createdAt` 不同
 */
export interface IMMessageBrief {
  id: number
  senderId: number
  msgType: string
  content: string
  createAt: string
}

/** 会话状态：stranger 陌生（发起方受额度限制） / unlocked 已解锁 */
export type IMConversationStatus = 'stranger' | 'unlocked'

/** 会话（conversation/list、conversation/get_info 返回） */
export interface IMConversation {
  id: number
  peer: IMUserBrief
  status: IMConversationStatus
  canSend: boolean
  /** 当前用户剩余可发条数，-1 表示不限 */
  quotaRemaining: number
  lastMessage?: IMMessageBrief
  unread: number
  lastMessageAt: string
}

/** 单条消息（message/list、message/sync 返回） */
export interface IMMessage {
  id: number
  conversationId: number
  senderId: number
  receiverId: number
  msgType: string
  content: string
  clientMsgId: string
  createdAt: string
}

/** 消息列表（倒序返回，nextCursor 为本页最旧消息 ID） */
export interface IMMessageList {
  list: IMMessage[]
  nextCursor: number
  hasMore: boolean
}

/** 发送结果：比普通消息多出会话状态与额度信息 */
export interface IMSendResult extends IMMessage {
  status: IMConversationStatus
  quotaRemaining: number
  /** 本条消息是否触发了会话解锁 */
  unlocked: boolean
}

/** 未读汇总 */
export interface IMUnreadItem {
  conversationId: number
  unread: number
}

export interface IMUnread {
  total: number
  conversations: IMUnreadItem[]
}

export interface IMWsTicket {
  ticket: string
  expiresIn: number
}

/** ============ WebSocket 事件 ============ */

export interface IMNewMessagePayload {
  id: number
  conversationId: number
  senderId: number
  receiverId: number
  msgType: string
  content: string
  clientMsgId: string
  createdAt: string
  /** 离线 sync 补齐的消息不带会话状态 */
  status?: IMConversationStatus
  unlocked?: boolean
}

export interface IMReadPayload {
  conversationId: number
  readerId: number
  lastReadId: number
}

export interface IMUnlockedPayload {
  conversationId: number
  unlockedAt: string
}

export type IMWsEventType = 'message.new' | 'message.read' | 'conversation.unlocked'

export type IMWsEventData = IMNewMessagePayload | IMReadPayload | IMUnlockedPayload

export interface IMWsEvent {
  type: IMWsEventType
  data: IMWsEventData
  at: number
  /** 离线补齐消息的内部标记，仅前端使用 */
  synced?: boolean
}

/** 私信额度耗尽业务码（HTTP 仍为 200，错误码在响应体 code 中） */
export const IM_CODE_QUOTA_EXCEEDED = 4003

/** 单条消息正文长度上限（与后端校验保持一致） */
export const IM_MAX_CONTENT_LENGTH = 2000
