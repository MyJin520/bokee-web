import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  createConversation as createConversationApi,
  getConversations,
  getImConfig,
  getUnread,
  getWsTicket,
  markMessagesRead,
  syncMessages,
} from '@/api/im'
import { useUserStore } from '@/stores/user'
import { IM_DEFAULT_MAX_CONTENT_LENGTH } from '@/types/im'
import type {
  IMConversation,
  IMNewMessagePayload,
  IMReadPayload,
  IMSendResult,
  IMUnlockedPayload,
  IMWsEvent,
} from '@/types/im'

/** 会话列表单页数量（后端默认 10，这里显式放大） */
export const IM_CONVERSATION_PAGE_SIZE = 20
/** 离线同步单批上限 */
const SYNC_LIMIT = 200
/** 离线同步最多补齐 5 批，防止异常数据导致请求风暴 */
const SYNC_ROUNDS = 5
/** 收到未知会话的消息时，合并刷新会话列表的防抖时间 */
const REFRESH_DELAY = 400
/** 断线重连基础间隔与上限（指数退避） */
const RECONNECT_BASE = 1000
const RECONNECT_MAX = 30000
/** 每个用户独立的已同步游标，避免切换账号后串用 */
const SEQ_KEY_PREFIX = 'im:lastMessageId:'
/** 去重集合上限，超过后整体清空（只需覆盖近期事件） */
const RECENT_LIMIT = 800

type EventListener = (event: IMWsEvent) => void

/**
 * 私信数据与实时连接
 *
 * 职责划分：
 * - 本 store 负责会话列表、未读总数、WS 连接与事件分发、离线补齐；
 * - 会话页负责消息列表渲染与发送（发送走 HTTP，成功后回写会话状态）。
 *
 * 事件分发使用普通订阅回调而非响应式 ref，避免同一 tick 内的多条消息被合并丢失。
 */
export const useImStore = defineStore('im', () => {
  const userStore = useUserStore()

  const conversations = ref<IMConversation[]>([])
  const total = ref(0)
  const unreadTotal = ref(0)
  const connected = ref(false)
  const activeConversationId = ref<number | null>(null)
  /** 本地已收到的最大消息 ID（离线补齐游标） */
  const lastSeq = ref(0)
  /** 对方在各会话中的已读游标，用于展示「已读」 */
  const peerReadCursors = ref<Record<number, number>>({})
  /** 单条消息正文长度上限，登录后由后端配置下发，前端不硬编码 */
  const maxContentLength = ref(IM_DEFAULT_MAX_CONTENT_LENGTH)

  const listeners = new Set<EventListener>()
  const recentIds = new Set<number>()

  let ws: WebSocket | null = null
  let reconnectTimer: number | null = null
  let reconnectAttempt = 0
  let refreshTimer: number | null = null
  let manualClosed = true
  let startPromise: Promise<void> | null = null
  let syncPromise: Promise<void> | null = null
  let loadedPage = 0

  const myId = computed(() => userStore.userInfo?.id ?? 0)

  /* ============ 工具 ============ */

  function timeOf(value?: string): number {
    const time = value ? Date.parse(value) : 0
    return Number.isNaN(time) ? 0 : time
  }

  function sortConversations() {
    conversations.value.sort((a, b) => timeOf(b.lastMessageAt) - timeOf(a.lastMessageAt))
  }

  function seqKey(): string {
    return `${SEQ_KEY_PREFIX}${myId.value}`
  }

  function loadSeq() {
    const raw = Number(localStorage.getItem(seqKey()) || 0)
    lastSeq.value = Number.isFinite(raw) && raw > 0 ? raw : 0
  }

  function bumpSeq(id: number) {
    if (!myId.value || id <= lastSeq.value) return
    lastSeq.value = id
    localStorage.setItem(seqKey(), String(id))
  }

  function remember(id: number) {
    if (recentIds.has(id)) return false
    if (recentIds.size >= RECENT_LIMIT) recentIds.clear()
    recentIds.add(id)
    return true
  }

  /** 初始化游标：登录后、补齐前调用，避免把上一个账号的游标带进来 */
  function prepare() {
    recentIds.clear()
    loadSeq()
  }

  /* ============ 订阅 ============ */

  /** 订阅实时事件，返回取消订阅函数 */
  function subscribe(listener: EventListener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function emit(event: IMWsEvent) {
    listeners.forEach((listener) => {
      try {
        listener(event)
      } catch {
        // 单个订阅者异常不影响其他订阅者
      }
    })
  }

  /* ============ 会话数据 ============ */

  function findConversation(id: number): IMConversation | undefined {
    return conversations.value.find((item) => item.id === id)
  }

  /** 插入或更新会话，并按最后消息时间重新排序 */
  function upsertConversation(conversation: IMConversation) {
    const index = conversations.value.findIndex((item) => item.id === conversation.id)
    if (index >= 0) {
      conversations.value[index] = { ...conversations.value[index], ...conversation }
    } else {
      conversations.value.push(conversation)
    }
    sortConversations()
  }

  /** 拉取会话列表；page=1 且不追加时保留已翻页加载的会话，避免实时刷新回退列表 */
  async function loadConversations(page = 1, append = false) {
    const res = await getConversations(page, IM_CONVERSATION_PAGE_SIZE)
    total.value = res.total
    loadedPage = page

    if (append) {
      res.list.forEach((conversation) => {
        if (!findConversation(conversation.id)) conversations.value.push(conversation)
      })
      sortConversations()
      return
    }

    const merged = res.list.slice()
    conversations.value.forEach((old) => {
      if (!merged.some((item) => item.id === old.id)) merged.push(old)
    })
    conversations.value = merged
    sortConversations()
  }

  /** 刷新会话列表第一页（实时事件触发的静默刷新） */
  async function refreshFirstPage() {
    await loadConversations(1, false)
  }

  /** 加载更多会话（追加下一页） */
  async function loadMoreConversations() {
    if (conversations.value.length >= total.value) return
    await loadConversations(Math.max(loadedPage, 1) + 1, true)
  }

  async function loadUnread() {
    const res = await getUnread()
    unreadTotal.value = res.total
    const map = new Map(res.conversations.map((item) => [item.conversationId, item.unread]))
    conversations.value.forEach((conversation) => {
      conversation.unread = map.get(conversation.id) ?? 0
    })
  }

  /** 拉取私信规则配置；失败保留兜底值，不阻塞聊天 */
  async function loadConfig() {
    try {
      const res = await getImConfig()
      const limit = Number(res?.maxContentLength)
      if (Number.isFinite(limit) && limit > 0) maxContentLength.value = limit
    } catch {
      // 配置拉取失败时沿用兜底值，输入长度仍由后端最终校验
    }
  }

  function scheduleConversationRefresh() {
    if (refreshTimer !== null) return
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null
      refreshFirstPage().catch(() => {})
    }, REFRESH_DELAY)
  }

  /** 设置当前正在查看的会话（决定新消息是否直接计未读） */
  function setActiveConversation(id: number | null) {
    activeConversationId.value = id
  }

  /** 当前是否「正在看」某会话：会话被主动打开且页面可见 */
  function isReadingConversation(id: number): boolean {
    if (activeConversationId.value !== id) return false
    return typeof document === 'undefined' || document.visibilityState === 'visible'
  }

  /** 标记会话已读，并把本地未读数扣减 */
  async function markConversationRead(conversationId: number, lastReadId = 0) {
    const conversation = findConversation(conversationId)
    const before = conversation?.unread ?? 0
    try {
      const res = await markMessagesRead({ conversationId, lastReadId })
      if (conversation) conversation.unread = 0
      if (before > 0) unreadTotal.value = Math.max(0, unreadTotal.value - before)
      return res.lastReadId
    } catch {
      // 已读标记失败不打断聊天，下一次拉取未读数据会自动校正
      return 0
    }
  }

  /** 用发送结果回写会话状态（WS 未连接时也能保持列表最新） */
  function applySendResult(result: IMSendResult) {
    const conversation = findConversation(result.conversationId)
    if (!conversation) return
    conversation.status = result.status
    conversation.quotaRemaining = result.quotaRemaining
    conversation.canSend = result.status === 'unlocked' || result.quotaRemaining !== 0
    conversation.lastMessage = {
      id: result.id,
      senderId: result.senderId,
      msgType: result.msgType,
      content: result.content,
      createdAt: result.createdAt,
    }
    conversation.lastMessageAt = result.createdAt
    sortConversations()
  }

  /** 额度耗尽（业务码 4003）时同步本地会话状态 */
  function markQuotaExceeded(conversationId: number) {
    const conversation = findConversation(conversationId)
    if (!conversation) return
    conversation.quotaRemaining = 0
    conversation.canSend = false
  }

  /** 通过目标用户发起私信，返回会话（互关则由后端直接解锁） */
  async function openConversationByTarget(targetId: number): Promise<IMConversation> {
    const conversation = await createConversationApi(targetId)
    upsertConversation(conversation)
    return conversation
  }

  /* ============ 实时事件 ============ */

  function applyUnlocked(conversation: IMConversation) {
    conversation.status = 'unlocked'
    conversation.canSend = true
    conversation.quotaRemaining = -1
  }

  /** 补漏：同步离线消息后再校准会话列表与未读总数 */
  function catchUp() {
    void syncOffline().then(async () => {
      await refreshFirstPage().catch(() => {})
      await loadUnread().catch(() => {})
    })
  }

  function handleNewMessage(payload: IMNewMessagePayload) {
    if (!payload || !payload.id) return
    if (!remember(payload.id)) return

    // 全局消息 ID 出现跳号说明中间有消息没收到，补一次离线同步
    const gap = lastSeq.value > 0 && payload.id > lastSeq.value + 1
    bumpSeq(payload.id)

    const mine = payload.senderId === myId.value
    const conversation = findConversation(payload.conversationId)
    if (!conversation) {
      // 首次收到某个新会话的消息，列表里还没有它，静默刷新
      scheduleConversationRefresh()
      if (!mine && !isReadingConversation(payload.conversationId)) unreadTotal.value += 1
    } else {
      conversation.lastMessage = {
        id: payload.id,
        senderId: payload.senderId,
        msgType: payload.msgType,
        content: payload.content,
        createdAt: payload.createdAt,
      }
      conversation.lastMessageAt = payload.createdAt
      if (payload.status === 'unlocked') applyUnlocked(conversation)
      else if (payload.status) conversation.status = payload.status
      if (payload.unlocked) applyUnlocked(conversation)

      if (!mine && !isReadingConversation(conversation.id)) {
        conversation.unread += 1
        unreadTotal.value += 1
      }
      sortConversations()
    }

    if (gap) catchUp()
  }

  function handleReadMessage(payload: IMReadPayload) {
    if (!payload || !payload.conversationId) return
    // 只记录对方的已读回执；自己的已读由本地状态维护
    if (payload.readerId === myId.value) return
    const current = peerReadCursors.value[payload.conversationId] ?? 0
    if (payload.lastReadId <= current) return
    peerReadCursors.value = {
      ...peerReadCursors.value,
      [payload.conversationId]: payload.lastReadId,
    }
  }

  function handleUnlocked(payload: IMUnlockedPayload) {
    const conversation = findConversation(payload?.conversationId)
    if (conversation) applyUnlocked(conversation)
  }

  function handleEvent(event: IMWsEvent) {
    if (!event || typeof event.type !== 'string') return
    if (event.type === 'message.new') {
      handleNewMessage(event.data as IMNewMessagePayload)
    } else if (event.type === 'message.read') {
      handleReadMessage(event.data as IMReadPayload)
    } else if (event.type === 'conversation.unlocked') {
      handleUnlocked(event.data as IMUnlockedPayload)
    }
    emit(event)
  }

  /** 离线补齐：按本地游标同步收发消息，逐条分发给会话页合并 */
  function syncOffline(): Promise<void> {
    if (!myId.value) return Promise.resolve()
    if (syncPromise) return syncPromise

    syncPromise = (async () => {
      let afterId = lastSeq.value
      for (let round = 0; round < SYNC_ROUNDS; round += 1) {
        const res = await syncMessages(afterId, SYNC_LIMIT)
        res.list.forEach((message) => {
          if (!remember(message.id)) return
          bumpSeq(message.id)
          emit({
            type: 'message.new',
            data: {
              id: message.id,
              conversationId: message.conversationId,
              senderId: message.senderId,
              receiverId: message.receiverId,
              msgType: message.msgType,
              content: message.content,
              clientMsgId: message.clientMsgId,
              createdAt: message.createdAt,
              unlocked: false,
            },
            at: Date.now(),
            synced: true,
          })
        })
        if (!res.hasMore || res.list.length === 0) break
        afterId = res.nextCursor
      }
    })()
      .catch(() => {
        // 同步失败等下一次重连再补，不阻塞连接状态
      })
      .finally(() => {
        syncPromise = null
      })

    return syncPromise
  }

  /* ============ WebSocket ============ */

  function scheduleReconnect() {
    if (manualClosed || reconnectTimer !== null) return
    const base = Math.min(RECONNECT_MAX, RECONNECT_BASE * 2 ** Math.min(reconnectAttempt, 5))
    const delay = base + Math.floor(Math.random() * 500)
    reconnectAttempt += 1
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  /** 建立连接：先取一次性票据，再握手；关闭后指数退避重连 */
  async function connect() {
    if (manualClosed || !userStore.isLoggedIn || ws) return
    try {
      const { ticket } = await getWsTicket()
      if (manualClosed) return
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const socket = new WebSocket(
        `${scheme}://${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`,
      )
      ws = socket

      socket.onopen = () => {
        if (ws !== socket) return
        connected.value = true
        reconnectAttempt = 0
        // 重连后先补齐离线消息，再刷新未读与会话列表
        void (async () => {
          await syncOffline()
          await refreshFirstPage().catch(() => {})
          await loadUnread().catch(() => {})
        })()
      }

      socket.onmessage = (event) => {
        try {
          handleEvent(JSON.parse(String(event.data)) as IMWsEvent)
        } catch {
          // 非法事件直接忽略
        }
      }

      socket.onerror = () => {
        try {
          socket.close()
        } catch {
          // 忽略关闭异常
        }
      }

      socket.onclose = () => {
        if (ws === socket) ws = null
        connected.value = false
        scheduleReconnect()
      }
    } catch {
      scheduleReconnect()
    }
  }

  /** 登录后启动：拉未读 + 会话列表，再建立实时连接 */
  async function start() {
    if (!userStore.isLoggedIn || !myId.value) return
    if (startPromise) return startPromise
    // 已启动过（例如进入私信页时再次调用）不再重复拉数据与建连
    if (!manualClosed) return
    manualClosed = false
    prepare()

    startPromise = (async () => {
      await loadConfig()
      await loadUnread().catch(() => {})
      await refreshFirstPage().catch(() => {})
      await connect()
    })().finally(() => {
      startPromise = null
    })

    return startPromise
  }

  /** 登出或切换账号时停止连接并清空数据 */
  function stop() {
    manualClosed = true
    startPromise = null
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer)
      refreshTimer = null
    }
    reconnectAttempt = 0
    if (ws) {
      try {
        ws.close()
      } catch {
        // 忽略关闭异常
      }
      ws = null
    }
    connected.value = false
    conversations.value = []
    total.value = 0
    unreadTotal.value = 0
    activeConversationId.value = null
    peerReadCursors.value = {}
    maxContentLength.value = IM_DEFAULT_MAX_CONTENT_LENGTH
    lastSeq.value = 0
    loadedPage = 0
    recentIds.clear()
  }

  return {
    conversations,
    total,
    unreadTotal,
    connected,
    activeConversationId,
    lastSeq,
    peerReadCursors,
    maxContentLength,
    myId,
    subscribe,
    start,
    stop,
    connect,
    syncOffline,
    loadConversations,
    loadMoreConversations,
    refreshFirstPage,
    loadUnread,
    markConversationRead,
    setActiveConversation,
    upsertConversation,
    openConversationByTarget,
    applySendResult,
    markQuotaExceeded,
  }
})
