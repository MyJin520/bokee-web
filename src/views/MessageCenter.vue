<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getConversationInfo, getMessages, recallMessage, sendMessage } from '@/api/im'
import { uploadFiles } from '@/api/file'
import { ApiError } from '@/api/request'
import { useImStore } from '@/stores/im'
import { useUserStore } from '@/stores/user'
import { useUiStore } from '@/stores/ui'
import type {
  IMConversation,
  IMMessage,
  IMNewMessagePayload,
  IMRecallPayload,
  IMWsEvent,
} from '@/types/im'
import { IM_CODE_QUOTA_EXCEEDED } from '@/types/im'
import {
  canRecallMessage,
  formatMessageTime,
  formatDayLabel,
  isDifferentDay,
  messageBriefPreview,
  splitLinkSegments,
} from '@/utils/im'
import { initialOf } from '@/utils/format'
import ImConversationItem from '@/components/ImConversationItem.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const ui = useUiStore()
const im = useImStore()

/** 消息气泡：id 为 0 表示本地待发送（乐观渲染） */
interface ChatMessage extends IMMessage {
  pending?: boolean
}

const PAGE_SIZE = 30
const NEAR_BOTTOM = 80
/** 允许发送的图片 MIME 类型 */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const activeId = ref<number | null>(null)
const messages = ref<ChatMessage[]>([])
const hasMore = ref(false)
const olderCursor = ref(0)
const loadingLatest = ref(false)
const loadingOlder = ref(false)
const chatError = ref('')
const draft = ref('')
const sending = ref(false)
const sendingImage = ref(false)
const creating = ref(false)
const loadingList = ref(false)
const listError = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const imageInputEl = ref<HTMLInputElement | null>(null)
const atBottom = ref(true)
const showJump = ref(false)
/** 当前被引用的待回复消息 */
const replyingTo = ref<ChatMessage | null>(null)
/** 当前悬停操作条的消息标识（待发送气泡用 clientMsgId） */
const hoveredKey = ref<string | null>(null)
/** 加载失败的图片地址，用于渲染兜底占位 */
const brokenImages = ref<Set<string>>(new Set())

function markImageBroken(url: string) {
  if (!url || brokenImages.value.has(url)) return
  brokenImages.value = new Set(brokenImages.value).add(url)
}

/** 已提交给后端的最大已读消息 ID，避免重复请求 */
let lastMarkedId = 0
let unsubscribe: (() => void) | null = null

const myId = computed(() => userStore.userInfo?.id ?? 0)
const myName = computed(() => userStore.userInfo?.name ?? '我')
const myAvatar = computed(() => userStore.userInfo?.avatar ?? '')
const activeConv = computed(
  () => im.conversations.find((item) => item.id === activeId.value) ?? null,
)
const canLoadMore = computed(() => im.conversations.length < im.total)
/** 后端 total 只统计有消息的会话，刚建好还没发消息的新会话只存在于本地列表 */
const conversationCount = computed(() => Math.max(im.total, im.conversations.length))
const draftLength = computed(() => [...draft.value].length)
const canSubmit = computed(
  () => !!draft.value.trim() && !sending.value && !!activeConv.value?.canSend,
)
const peerReadId = computed(() =>
  activeId.value ? (im.peerReadCursors[activeId.value] ?? 0) : 0,
)
const lockHint = computed(() => {
  // quotaRemaining 为 -1 表示当前用户不受额度限制（例如被发起方回复的陌生会话）
  const quota = activeConv.value?.quotaRemaining ?? -1
  if (quota < 0) return '陌生会话 · 你可以自由回复'
  if (quota > 0) return `陌生会话 · 对方回复前还可发送 ${quota} 条`
  return '对方回复前最多发送 3 条，请等待对方回复后再继续'
})

/** 引用块显示的发送者昵称：引用我方消息显示我方昵称，引用对方显示对方昵称 */
function replySenderName(msg: ChatMessage): string {
  return msg.replyToSenderId === myId.value
    ? myName.value
    : activeConv.value?.peer.name ?? '对方'
}

/** 文本消息按链接拆分为渲染片段 */
function linkSegments(msg: ChatMessage) {
  return splitLinkSegments(msg.content)
}

/** 消息是否可撤回：本人发送、未落库失败、未撤回且仍在时间窗口内 */
function canRecall(msg: ChatMessage): boolean {
  return (
    msg.id > 0 &&
    msg.senderId === myId.value &&
    !msg.recalled &&
    canRecallMessage(msg.createdAt, im.recallWindowMin)
  )
}

/** 消息行的唯一标识，用于悬停操作条高亮 */
function messageKey(msg: ChatMessage): string {
  return msg.id > 0 ? `id:${msg.id}` : `client:${msg.clientMsgId}`
}

/** 原消息自身摘要（回复栏预览待引用的消息）：图片显示占位 */
function quotePreview(msg: ChatMessage): string {
  if (msg.msgType === 'image') return '[图片]'
  return msg.content || ''
}

/** 已发送消息的引用快照摘要：读取被引用快照字段，图片显示占位，不取本条正文 */
function replyPreview(msg: ChatMessage): string {
  if (msg.replyToMsgType === 'image') return '[图片]'
  return msg.replyToContent || ''
}

/**
 * 引用块状态：被引用消息已撤回时不再展示旧快照。
 * 优先以后端持久化标记为准；同一页面内原消息刚撤回、标记尚未回写时，按本地列表兜底判断。
 */
function quoteState(msg: ChatMessage): 'normal' | 'recalled' {
  if (msg.replyRecalled) return 'recalled'
  const quoted = messages.value.find((item) => item.id === msg.replyToId)
  if (quoted?.recalled) return 'recalled'
  return 'normal'
}

/* ============ 滚动 ============ */

function scrollToBottom(behavior: ScrollBehavior = 'auto') {
  nextTick(() => {
    const el = scrollEl.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    atBottom.value = true
    showJump.value = false
  })
}

function onScroll() {
  const el = scrollEl.value
  if (!el) return
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  atBottom.value = distance < NEAR_BOTTOM
  showJump.value = distance > 240
}

/* ============ 消息合并 ============ */

function maxMessageId(): number {
  return messages.value.reduce((max, msg) => (msg.id > max ? msg.id : max), 0)
}

function mergeMessages(groups: ChatMessage[][]): ChatMessage[] {
  const seenIds = new Set<number>()
  const seenClients = new Set<string>()
  const ordered: ChatMessage[] = []
  const pending: ChatMessage[] = []

  for (const group of groups) {
    for (const msg of group) {
      if (msg.id > 0) {
        if (seenIds.has(msg.id)) continue
        seenIds.add(msg.id)
        ordered.push(msg)
      } else {
        if (msg.clientMsgId && seenClients.has(msg.clientMsgId)) continue
        if (msg.clientMsgId) seenClients.add(msg.clientMsgId)
        pending.push(msg)
      }
    }
  }

  ordered.sort((a, b) => a.id - b.id)
  return [...ordered, ...pending]
}

/** 插入一条消息：按 id 去重，并用真实消息替换同 clientMsgId 的待发送气泡 */
function appendMessage(message: IMMessage) {
  const list = messages.value
  const pendingIndex = message.clientMsgId
    ? list.findIndex((item) => item.id === 0 && item.clientMsgId === message.clientMsgId)
    : -1

  if (message.id > 0) {
    // WS 先到、HTTP 后到时会出现同 ID 消息，此时顺手清掉残留的待发送气泡
    if (list.some((item) => item.id === message.id)) {
      if (pendingIndex >= 0) list.splice(pendingIndex, 1)
      return
    }
    const target: ChatMessage = { ...message }
    if (pendingIndex >= 0) {
      list[pendingIndex] = target
      return
    }
    const index = list.findIndex((item) => item.id === 0 || item.id > message.id)
    if (index === -1) list.push(target)
    else list.splice(index, 0, target)
    return
  }

  if (pendingIndex >= 0) {
    list[pendingIndex] = { ...message }
    return
  }
  list.push({ ...message })
}

/* ============ 会话打开 ============ */

async function syncQuery(id: number) {
  if (String(route.query.id ?? '') === String(id) && !route.query.target) return
  await router.replace({ name: 'messages', query: { id: String(id) } })
}

async function clearQuery() {
  if (route.query.id || route.query.target) {
    await router.replace({ name: 'messages' })
  }
}

async function refreshConversationInfo(id: number) {
  try {
    im.upsertConversation(await getConversationInfo(id))
  } catch {
    // 详情只用于校准状态，失败不打断聊天
  }
}

async function markReadNow() {
  const conv = activeConv.value
  if (!conv) return
  if (document.visibilityState !== 'visible') return
  const lastId = maxMessageId()
  if (lastId === 0) {
    if (conv.unread > 0) await im.markConversationRead(conv.id, 0)
    return
  }
  if (lastId <= lastMarkedId && conv.unread === 0) return
  const readId = await im.markConversationRead(conv.id, lastId)
  // 只有服务端确认后才推进本地游标，失败时下次事件会重试
  if (readId > 0) lastMarkedId = Math.max(lastMarkedId, readId)
}

async function loadLatest() {
  const conv = activeConv.value
  if (!conv) return
  loadingLatest.value = true
  chatError.value = ''
  messages.value = []
  hasMore.value = false
  olderCursor.value = 0
  lastMarkedId = 0
  try {
    const res = await getMessages({ conversationId: conv.id, lastId: 0, pageSize: PAGE_SIZE })
    // 接口倒序返回，前端统一按时间正序渲染
    messages.value = [...res.list].reverse().map((item) => ({ ...item }))
    hasMore.value = res.hasMore
    olderCursor.value = res.nextCursor
  } catch (error: unknown) {
    chatError.value = error instanceof Error ? error.message : '消息加载失败，请稍后重试'
  } finally {
    loadingLatest.value = false
  }
}

async function loadOlder() {
  const conv = activeConv.value
  if (!conv || !hasMore.value || loadingOlder.value || !olderCursor.value) return
  loadingOlder.value = true
  const el = scrollEl.value
  const prevHeight = el?.scrollHeight ?? 0
  const prevTop = el?.scrollTop ?? 0
  try {
    const res = await getMessages({
      conversationId: conv.id,
      lastId: olderCursor.value,
      pageSize: PAGE_SIZE,
    })
    const older = [...res.list].reverse()
    messages.value = mergeMessages([older, messages.value])
    hasMore.value = res.hasMore
    olderCursor.value = res.nextCursor
    // 保持视觉位置：补上新增内容的高度差
    await nextTick()
    if (el) el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
  } catch (error: unknown) {
    ui.toastError(error instanceof Error ? error.message : '更早的消息加载失败')
  } finally {
    loadingOlder.value = false
  }
}

async function selectConversation(conv: IMConversation | null | undefined, syncRoute = true) {
  if (!conv) return
  if (activeId.value === conv.id) {
    if (syncRoute) await syncQuery(conv.id)
    return
  }
  activeId.value = conv.id
  im.setActiveConversation(conv.id)
  replyingTo.value = null
  if (syncRoute) await syncQuery(conv.id)
  await loadLatest()
  await markReadNow()
  scrollToBottom()
  void refreshConversationInfo(conv.id)
}

async function openById(id: number, syncRoute = true) {
  if (!id) return
  if (id === activeId.value) {
    if (syncRoute) await syncQuery(id)
    return
  }
  let conv = im.conversations.find((item) => item.id === id)
  if (!conv) {
    try {
      conv = await getConversationInfo(id)
      im.upsertConversation(conv)
    } catch (error: unknown) {
      ui.toastError(error instanceof Error ? error.message : '会话不存在或无权访问')
      await clearQuery()
      return
    }
  }
  await selectConversation(conv, syncRoute)
}

/** 从作者主页「私信 TA」进入：先创建会话，再打开 */
async function startWithTarget(targetId: number) {
  if (!targetId || creating.value) return
  if (targetId === myId.value) {
    ui.toastError('不能给自己发私信')
    await clearQuery()
    return
  }
  creating.value = true
  try {
    const conv = await im.openConversationByTarget(targetId)
    await selectConversation(conv)
  } catch (error: unknown) {
    ui.toastError(error instanceof Error ? error.message : '无法发起私信，请稍后重试')
    await clearQuery()
  } finally {
    creating.value = false
  }
}

function closeChat() {
  activeId.value = null
  im.setActiveConversation(null)
  messages.value = []
  replyingTo.value = null
  lastMarkedId = 0
  void clearQuery()
}

/* ============ 会话列表 ============ */

async function reloadConversations() {
  loadingList.value = true
  listError.value = ''
  try {
    await im.refreshFirstPage()
  } catch (error: unknown) {
    listError.value = error instanceof Error ? error.message : '会话加载失败，请稍后重试'
  } finally {
    loadingList.value = false
  }
}

async function loadMoreConversations() {
  if (loadingList.value) return
  loadingList.value = true
  try {
    await im.loadMoreConversations()
  } catch (error: unknown) {
    ui.toastError(error instanceof Error ? error.message : '更多会话加载失败')
  } finally {
    loadingList.value = false
  }
}

/* ============ 发送 ============ */

function createClientMsgId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 组装引用快照（乐观气泡使用；服务端返回后以库中快照为准） */
function quoteSnapshot(): Pick<ChatMessage, 'replyToId' | 'replyToSenderId' | 'replyToMsgType' | 'replyToContent'> {
  const quoted = replyingTo.value
  if (!quoted) {
    return { replyToId: 0, replyToSenderId: 0, replyToMsgType: '', replyToContent: '' }
  }
  return {
    replyToId: quoted.id,
    replyToSenderId: quoted.senderId,
    replyToMsgType: quoted.msgType,
    replyToContent: messageBriefPreview(quoted),
  }
}

async function send() {
  const conv = activeConv.value
  if (!conv) return
  const content = draft.value.trim()
  if (!content || sending.value) return
  if (!conv.canSend) {
    ui.toastError(lockHint.value)
    return
  }
  if ([...content].length > im.maxContentLength) {
    ui.toastError(`消息内容不能超过 ${im.maxContentLength} 个字符`)
    return
  }

  const clientMsgId = createClientMsgId()
  const quote = quoteSnapshot()
  const optimistic: ChatMessage = {
    id: 0,
    conversationId: conv.id,
    senderId: myId.value,
    receiverId: conv.peer.id,
    msgType: 'text',
    content,
    clientMsgId,
    ...quote,
    replyRecalled: false,
    recalled: false,
    createdAt: new Date().toISOString(),
    pending: true,
  }
  messages.value.push(optimistic)
  draft.value = ''
  replyingTo.value = null
  sending.value = true
  scrollToBottom()

  try {
    const result = await sendMessage({
      targetId: conv.peer.id,
      content,
      clientMsgId,
      replyToId: quote.replyToId,
    })
    appendMessage(result)
    im.applySendResult(result)
    if (result.unlocked) ui.toast('会话已解锁，可以自由沟通')
    scrollToBottom()
  } catch (error: unknown) {
    // 发送失败：撤掉乐观气泡，把内容还给输入框，复用 clientMsgId 的重试交给用户再次发送
    messages.value = messages.value.filter(
      (item) => !(item.id === 0 && item.clientMsgId === clientMsgId),
    )
    if (!draft.value) draft.value = content
    const code = error instanceof ApiError ? error.code : 0
    if (code === IM_CODE_QUOTA_EXCEEDED) {
      im.markQuotaExceeded(conv.id)
    }
    ui.toastError(error instanceof Error ? error.message : '消息发送失败，请稍后重试')
  } finally {
    sending.value = false
    inputEl.value?.focus()
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void send()
}

/* ============ 引用 ============ */

function startReply(msg: ChatMessage) {
  if (msg.recalled || msg.id === 0) return
  replyingTo.value = msg
  inputEl.value?.focus()
}

function cancelReply() {
  replyingTo.value = null
}

/** 点击引用块定位到被引用消息 */
function locateReply(msg: ChatMessage) {
  if (!msg.replyToId) return
  const el = scrollEl.value?.querySelector(`[data-message-id="${msg.replyToId}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/* ============ 图片 ============ */

function pickImage() {
  imageInputEl.value?.click()
}

async function onImagePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const conv = activeConv.value
  if (!file || !conv) return
  if (!IMAGE_TYPES.includes(file.type)) {
    ui.toastError('仅支持发送 JPG / PNG / GIF / WebP 图片')
    return
  }
  if (file.size > 32 << 20) {
    ui.toastError('图片大小不能超过 32MB')
    return
  }
  if (!conv.canSend) {
    ui.toastError(lockHint.value)
    return
  }

  sendingImage.value = true
  try {
    const [uploaded] = await uploadFiles([file])
    if (!uploaded?.url) {
      ui.toastError('图片上传失败，请稍后重试')
      return
    }
    await sendImageMessage(conv, uploaded.url)
  } catch (error: unknown) {
    ui.toastError(error instanceof Error ? error.message : '图片发送失败，请稍后重试')
  } finally {
    sendingImage.value = false
  }
}

async function sendImageMessage(conv: IMConversation, url: string) {
  const clientMsgId = createClientMsgId()
  const quote = quoteSnapshot()
  const optimistic: ChatMessage = {
    id: 0,
    conversationId: conv.id,
    senderId: myId.value,
    receiverId: conv.peer.id,
    msgType: 'image',
    content: url,
    clientMsgId,
    ...quote,
    replyRecalled: false,
    recalled: false,
    createdAt: new Date().toISOString(),
    pending: true,
  }
  messages.value.push(optimistic)
  replyingTo.value = null
  scrollToBottom()

  try {
    const result = await sendMessage({
      targetId: conv.peer.id,
      content: url,
      clientMsgId,
      msgType: 'image',
      replyToId: quote.replyToId,
    })
    appendMessage(result)
    im.applySendResult(result)
    scrollToBottom()
  } catch (error: unknown) {
    messages.value = messages.value.filter(
      (item) => !(item.id === 0 && item.clientMsgId === clientMsgId),
    )
    ui.toastError(error instanceof Error ? error.message : '图片发送失败，请稍后重试')
  }
}

/* ============ 撤回 ============ */

/** 本地把消息标记为撤回（WS 事件与接口成功回调共用） */
function applyRecalled(messageId: number) {
  const target = messages.value.find((item) => item.id === messageId)
  if (!target) return
  target.recalled = true
  target.content = ''
  target.replyToId = 0
  target.replyToSenderId = 0
  target.replyToMsgType = ''
  target.replyToContent = ''
  if (replyingTo.value?.id === messageId) replyingTo.value = null
  // 本地实时兜底：引用了该消息的其他消息同步标记引用快照失效
  messages.value.forEach((item) => {
    if (item.replyToId === messageId && !item.recalled) {
      item.replyRecalled = true
      item.replyToContent = ''
      item.replyToMsgType = ''
    }
  })
}

async function onRecall(msg: ChatMessage) {
  if (!canRecall(msg)) return
  try {
    await recallMessage(msg.id)
    applyRecalled(msg.id)
  } catch (error: unknown) {
    ui.toastError(error instanceof Error ? error.message : '消息撤回失败，请稍后重试')
  }
}

/* ============ 实时事件 ============ */

function onEvent(event: IMWsEvent) {
  if (event.type === 'message.recalled') {
    const payload = event.data as unknown as IMRecallPayload
    if (!activeId.value || payload.conversationId !== activeId.value) return
    applyRecalled(payload.messageId)
    return
  }
  if (event.type !== 'message.new') return
  const payload = event.data as IMNewMessagePayload
  if (!activeId.value || payload.conversationId !== activeId.value) return

  const fromPeer = payload.senderId !== myId.value
  appendMessage(payload as unknown as IMMessage)

  if (fromPeer) {
    void markReadNow()
    if (atBottom.value) scrollToBottom('smooth')
    else showJump.value = true
    return
  }
  if (atBottom.value) scrollToBottom()
}

/* ============ 日期分隔 ============ */

function showDay(index: number): boolean {
  const current = messages.value[index]
  if (!current) return false
  if (index === 0) return true
  return isDifferentDay(messages.value[index - 1]?.createdAt, current.createdAt)
}

function dayLabel(index: number): string {
  return formatDayLabel(messages.value[index]?.createdAt)
}

/* ============ 生命周期 ============ */

function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return
  if (!activeConv.value) return
  void markReadNow()
  void im.loadUnread().catch(() => {})
}

async function openFromRoute() {
  const target = Number(route.query.target || 0)
  if (target) {
    await startWithTarget(target)
    return
  }
  const convId = Number(route.query.id || 0)
  if (convId) {
    await openById(convId, false)
    return
  }
  // 桌面端默认选中最近的会话，移动端停留在列表
  const wide = !window.matchMedia('(max-width: 880px)').matches
  if (wide && im.conversations.length) {
    await selectConversation(im.conversations[0], false)
  }
}

onMounted(async () => {
  // 页面直接刷新进入时，等待根组件恢复登录态
  if (!userStore.userInfo && userStore.isLoggedIn) await userStore.restoreSession()
  unsubscribe = im.subscribe(onEvent)
  document.addEventListener('visibilitychange', onVisibilityChange)
  await im.start()
  await openFromRoute()
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
  document.removeEventListener('visibilitychange', onVisibilityChange)
  im.setActiveConversation(null)
})

watch(
  () => route.query.id,
  (value) => {
    const id = Number(value || 0)
    if (id && id !== activeId.value) void openById(id, false)
  },
)

watch(
  () => route.query.target,
  (value) => {
    const target = Number(value || 0)
    if (target) void startWithTarget(target)
  },
)
</script>

<template>
  <div :class="['messages-page', { 'chat-open': !!activeConv }]">
    <header class="page-header">
      <div>
        <span class="eyebrow">Direct messages</span>
        <h1>私信</h1>
        <p>给喜欢的作者递张小纸条。陌生会话发起方最多 3 条，对方回复后自动解锁。</p>
      </div>
      <router-link class="btn btn-outline btn-sm" :to="{ name: 'authors' }">发现作者 →</router-link>
    </header>

    <section :class="['im-shell', { 'chat-open': !!activeConv }]">
      <aside class="conv-pane">
        <div class="pane-head">
          <span class="pane-title">会话</span>
          <span class="pane-count">{{ conversationCount }}</span>
          <span class="pane-state" :class="{ offline: !im.connected }">
            {{ im.connected ? '实时' : '重连中' }}
          </span>
          <button
            class="pane-refresh"
            type="button"
            title="刷新会话"
            :disabled="loadingList"
            @click="reloadConversations"
          >
            ⟳
          </button>
        </div>

        <div v-if="loadingList && !im.conversations.length" class="pane-state-block">
          <div class="spinner"></div>
          <p>正在读取会话…</p>
        </div>
        <div v-else-if="listError" class="pane-state-block">
          <p>{{ listError }}</p>
          <button class="text-button" type="button" @click="reloadConversations">重新加载 →</button>
        </div>
        <div v-else-if="!im.conversations.length" class="pane-state-block empty">
          <p class="pane-empty-title">还没有会话</p>
          <p>去作者主页点「私信」，第一条对话就从这里开始。</p>
          <router-link class="text-button" :to="{ name: 'authors' }">去发现作者 →</router-link>
        </div>
        <div v-else class="conv-list">
          <ImConversationItem
            v-for="conv in im.conversations"
            :key="conv.id"
            :conversation="conv"
            :active="conv.id === activeId"
            :my-id="myId"
            @select="selectConversation"
          />
          <button
            v-if="canLoadMore"
            class="load-more"
            type="button"
            :disabled="loadingList"
            @click="loadMoreConversations"
          >
            {{ loadingList ? '加载中…' : '加载更多会话' }}
          </button>
        </div>
      </aside>

      <section class="chat-pane">
        <div v-if="!activeConv" class="chat-empty">
          <span class="chat-empty-mark">✉</span>
          <p class="chat-empty-title">选一段对话，或者去作者主页发起私信</p>
          <p class="chat-empty-hint">
            支持文本、图片与引用回复；陌生会话在对方回复前最多发送 3 条，互相关注则直接解锁。
          </p>
        </div>

        <template v-else>
          <header class="chat-head">
            <button class="chat-back" type="button" aria-label="返回会话列表" @click="closeChat">
              ←
            </button>
            <span class="chat-avatar">
              <img
                v-if="activeConv.peer.avatar"
                :src="activeConv.peer.avatar"
                :alt="activeConv.peer.name"
              />
              <template v-else>{{ initialOf(activeConv.peer.name) }}</template>
            </span>
            <div class="chat-peer">
              <span class="chat-name">{{ activeConv.peer.name }}</span>
              <span class="chat-status" :class="{ stranger: activeConv.status === 'stranger' }">
                <template v-if="activeConv.status === 'stranger'">{{ lockHint }}</template>
                <template v-else>已解锁 · 可自由沟通</template>
                <span v-if="!im.connected" class="chat-offline"> · 实时连接重连中</span>
              </span>
            </div>
            <router-link
              class="chat-profile"
              :to="{ name: 'user-profile', params: { id: activeConv.peer.id } }"
            >
              主页 →
            </router-link>
          </header>

          <div ref="scrollEl" class="chat-body" @scroll="onScroll">
            <div v-if="loadingLatest" class="chat-state">
              <div class="spinner"></div>
              <p>正在读取消息…</p>
            </div>
            <div v-else-if="chatError" class="chat-state">
              <p>{{ chatError }}</p>
              <button class="text-button" type="button" @click="loadLatest">重新加载 →</button>
            </div>
            <template v-else>
              <div v-if="hasMore" class="load-older">
                <button type="button" :disabled="loadingOlder" @click="loadOlder">
                  {{ loadingOlder ? '加载中…' : '↑ 加载更早的消息' }}
                </button>
              </div>
              <div v-else class="chat-start">
                与 {{ activeConv.peer.name }} 的对话从这里开始
              </div>

              <template v-for="(msg, index) in messages" :key="msg.id || msg.clientMsgId">
                <div v-if="showDay(index)" class="day-divider">
                  <span>{{ dayLabel(index) }}</span>
                </div>

                <div v-if="msg.recalled" class="recalled-row">
                  <span class="recalled-note">
                    {{ msg.senderId === myId ? '你撤回了一条消息' : '对方撤回了一条消息' }}
                  </span>
                </div>

                <div
                  v-else
                  :class="['msg-row', { mine: msg.senderId === myId }]"
                  :data-message-id="msg.id || undefined"
                  @mouseenter="hoveredKey = messageKey(msg)"
                  @mouseleave="hoveredKey = null"
                >
                  <span v-if="msg.senderId !== myId" class="msg-avatar">
                    <img
                      v-if="activeConv.peer.avatar"
                      :src="activeConv.peer.avatar"
                      :alt="activeConv.peer.name"
                    />
                    <template v-else>{{ initialOf(activeConv.peer.name) }}</template>
                  </span>
                  <div class="msg-body">
                    <div class="bubble-card">
                      <button
                        v-if="msg.replyToId"
                        type="button"
                        class="bubble-quote"
                        :class="{ 'quote-disabled': quoteState(msg) === 'recalled' }"
                        @click="quoteState(msg) === 'normal' && locateReply(msg)"
                      >
                        <span class="quote-name">{{ replySenderName(msg) }}:</span>
                        <span v-if="quoteState(msg) === 'recalled'" class="quote-text quote-recalled">
                          引用内容已撤回
                        </span>
                        <span v-else class="quote-text">{{ replyPreview(msg) }}</span>
                      </button>

                      <a
                        v-if="msg.msgType === 'image' && !brokenImages.has(msg.content)"
                        class="bubble-image"
                        :href="msg.content"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          :src="msg.content"
                          alt="图片消息"
                          loading="lazy"
                          @error="markImageBroken(msg.content)"
                        />
                      </a>
                      <span v-else-if="msg.msgType === 'image'" class="bubble-image-broken">
                        图片无法加载
                      </span>
                      <p v-else class="bubble-content">
                        <template v-for="(seg, segIndex) in linkSegments(msg)" :key="segIndex">
                          <a
                            v-if="seg.kind === 'link'"
                            class="msg-link"
                            :href="seg.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            >{{ seg.text }}</a
                          >
                          <span v-else>{{ seg.text }}</span>
                        </template>
                      </p>
                    </div>

                    <p class="msg-meta">
                      <span>{{ formatMessageTime(msg.createdAt) }}</span>
                      <span v-if="msg.pending" class="meta-note">发送中…</span>
                      <span
                        v-else-if="
                          msg.id > 0 && msg.senderId === myId && peerReadId >= msg.id
                        "
                        class="meta-note"
                      >
                        已读
                      </span>
                    </p>
                  </div>
                  <span v-if="msg.senderId === myId" class="msg-avatar mine-avatar">
                    <img v-if="myAvatar" :src="myAvatar" :alt="myName" />
                    <template v-else>{{ initialOf(myName) }}</template>
                  </span>
                  <div class="msg-actions" :class="{ show: hoveredKey === messageKey(msg) }">
                    <button
                      v-if="msg.id > 0 && !msg.recalled"
                      type="button"
                      class="action-btn"
                      @click="startReply(msg)"
                    >
                      引用
                    </button>
                    <button
                      v-if="canRecall(msg)"
                      type="button"
                      class="action-btn"
                      @click="onRecall(msg)"
                    >
                      撤回
                    </button>
                  </div>
                </div>
              </template>

              <div v-if="!messages.length" class="chat-state">
                <p>还没有消息，先说句你好吧。</p>
              </div>
            </template>
          </div>

          <button v-if="showJump" class="jump-btn" type="button" @click="scrollToBottom('smooth')">
            ↓ 回到最新
          </button>

          <footer class="composer">
            <div v-if="!activeConv.canSend" class="composer-lock">
              {{ lockHint }}
            </div>

            <div v-if="replyingTo" class="reply-bar">
              <div class="reply-bar-main">
                <span class="reply-bar-label">
                  回复 {{ replyingTo.senderId === myId ? myName : activeConv.peer.name }}
                </span>
                <span class="reply-bar-text">{{ quotePreview(replyingTo) }}</span>
              </div>
              <button type="button" class="reply-bar-close" aria-label="取消引用" @click="cancelReply">
                ×
              </button>
            </div>

            <div class="composer-box">
              <input
                ref="imageInputEl"
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                hidden
                @change="onImagePicked"
              />
              <button
                class="icon-btn"
                type="button"
                title="发送图片"
                :disabled="!activeConv.canSend || sendingImage || sending"
                @click="pickImage"
              >
                {{ sendingImage ? '…' : '🖼' }}
              </button>
              <textarea
                ref="inputEl"
                v-model="draft"
                class="composer-input"
                rows="3"
                :maxlength="im.maxContentLength"
                :disabled="!activeConv.canSend"
                placeholder="说点什么…（Enter 发送，Shift + Enter 换行）"
                @keydown="onKeydown"
              ></textarea>
              <div class="composer-actions">
                <span class="composer-count" :class="{ over: draftLength > im.maxContentLength }">
                  {{ draftLength }} / {{ im.maxContentLength }}
                </span>
                <button
                  class="btn btn-coral btn-sm"
                  type="button"
                  :disabled="!canSubmit"
                  @click="send"
                >
                  {{ sending ? '发送中…' : '发送' }}
                </button>
              </div>
            </div>
          </footer>
        </template>
      </section>
    </section>
  </div>
</template>

<style scoped>
.messages-page {
  padding: 44px 0 64px;
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}

.page-header h1 {
  margin: 14px 0 8px;
  font-family: 'Playfair Display', Georgia, serif;
  font-size: clamp(34px, 4.6vw, 54px);
  font-weight: 500;
  letter-spacing: -0.02em;
}

.page-header p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.im-shell {
  display: grid;
  grid-template-columns: 288px minmax(0, 1fr);
  height: min(70vh, 720px);
  min-height: 500px;
  border: 1px solid var(--line);
  background: var(--surface);
}

/* ============ 会话列表 ============ */

.conv-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  background: var(--paper);
}

.pane-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}

.pane-title {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.pane-count {
  padding: 1px 6px;
  background: var(--ink);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
}

.pane-state {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-size: 10px;
}

.pane-state::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6f9a58;
}

.pane-state.offline {
  color: var(--coral-dark);
}

.pane-state.offline::before {
  background: var(--coral);
}

.pane-refresh {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  font-size: 13px;
}

.pane-refresh:hover:not(:disabled) {
  border-color: var(--ink);
  color: var(--ink);
}

.conv-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.pane-state-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  padding: 24px 20px;
  color: var(--muted);
  font-size: 12px;
  text-align: left;
}

.pane-state-block .spinner {
  align-self: center;
}

.pane-empty-title {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}

.load-more {
  width: 100%;
  padding: 12px;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  font-size: 11px;
}

.load-more:hover:not(:disabled) {
  color: var(--ink);
}

/* ============ 对话区 ============ */

.chat-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 30px;
  text-align: center;
}

.chat-empty-mark {
  width: 62px;
  height: 62px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--line);
  color: var(--coral);
  font-size: 26px;
}

.chat-empty-title {
  margin: 10px 0 0;
  font-size: 14px;
  font-weight: 700;
}

.chat-empty-hint {
  max-width: 320px;
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.chat-head {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.chat-back {
  display: none;
  width: 26px;
  height: 26px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font-size: 13px;
}

.chat-avatar {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  overflow: hidden;
  background: var(--ink);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
}

.chat-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.chat-peer {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.chat-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 700;
}

.chat-status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.02em;
}

.chat-status.stranger {
  color: var(--coral-dark);
}

.chat-offline {
  color: var(--muted);
}

.chat-profile {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--muted);
  font-size: 11px;
}

.chat-profile:hover {
  color: var(--ink);
}

.chat-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px 10px;
  background: linear-gradient(0deg, rgba(24, 34, 31, 0.02), transparent 120px), var(--surface);
}

.chat-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}

.load-older {
  display: flex;
  justify-content: center;
  padding-bottom: 14px;
}

.load-older button {
  padding: 6px 14px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}

.load-older button:hover:not(:disabled) {
  border-color: var(--ink);
  color: var(--ink);
}

.chat-start {
  padding: 4px 0 18px;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-align: center;
}

.day-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.day-divider span {
  flex-shrink: 0;
}

.day-divider::before,
.day-divider::after {
  content: '';
  height: 1px;
  flex: 1;
  background: var(--line);
}

.msg-row {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 12px;
}

.msg-row.mine {
  justify-content: flex-end;
}

.msg-avatar {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  overflow: hidden;
  background: var(--ink);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}

.msg-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.msg-body {
  max-width: min(72%, 460px);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.msg-row.mine .msg-body {
  align-items: flex-end;
}

/* ============ 气泡容器（引用区 + 正文同属一个气泡） ============ */

.bubble-card {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: 0;
  background: var(--surface);
  color: var(--ink);
  font-size: 13px;
  overflow: hidden;
}

.msg-row.mine .bubble-card {
  border-color: rgba(231, 111, 81, 0.35);
  background: var(--coral-tint);
  color: var(--coral-dark);
}

.bubble-content {
  margin: 0;
  padding: 9px 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ============ 内嵌引用区 ============ */

.bubble-quote {
  display: flex;
  align-items: baseline;
  gap: 5px;
  max-width: 100%;
  margin: 0;
  padding: 7px 10px;
  border: 0;
  border-left: 3px solid var(--muted);
  border-bottom: 1px solid var(--line);
  background: var(--paper);
  color: var(--muted);
  font-size: 0.6em;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}

.msg-row.mine .bubble-quote {
  border-left-color: var(--coral);
  border-bottom-color: rgba(231, 111, 81, 0.25);
  background: rgba(255, 255, 255, 0.45);
  color: var(--muted);
}

.bubble-quote .quote-name {
  flex-shrink: 0;
  font-weight: 600;
}

.bubble-quote .quote-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quote-disabled {
  cursor: default;
}

.quote-recalled {
  font-style: italic;
}

.msg-row.mine .quote-recalled {
  color: var(--muted);
}

.msg-meta {
  display: flex;
  gap: 6px;
  margin: 0;
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 0.02em;
}

.meta-note {
  color: var(--coral-dark);
}

/* ============ 撤回提示 ============ */

.recalled-row {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}

.recalled-note {
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}

/* ============ 图片消息 ============ */

.bubble-image {
  display: inline-block;
  max-width: 100%;
  padding: 4px;
}

.bubble-image img {
  display: block;
  max-width: 220px;
  max-height: 220px;
  border-radius: 0;
  object-fit: cover;
}

.bubble-image-broken {
  display: inline-block;
  padding: 18px 22px;
  color: var(--muted);
  font-size: 11px;
}

.msg-link {
  color: var(--coral-dark);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.msg-row.mine .msg-link {
  color: var(--coral-dark);
  text-decoration-color: rgba(201, 88, 60, 0.5);
}

/* ============ 消息操作条 ============ */

.msg-actions {
  display: none;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}

.msg-row:hover .msg-actions {
  display: flex;
}

.msg-row.mine .msg-actions {
  order: 0;
}

.msg-row.mine .msg-body {
  order: 1;
}

.msg-row.mine .mine-avatar {
  order: 2;
}

.action-btn {
  padding: 3px 8px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--muted);
  font-size: 10px;
  cursor: pointer;
}

.action-btn:hover {
  border-color: var(--ink);
  color: var(--ink);
}

/* ============ 输入区扩展 ============ */

.reply-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  background: var(--paper);
}

.reply-bar-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.reply-bar-label {
  font-size: 10px;
  color: var(--muted);
}

.reply-bar-text {
  overflow: hidden;
  font-size: 11px;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reply-bar-close {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
}

.icon-btn {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  font-size: 16px;
  cursor: pointer;
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.jump-btn {
  position: absolute;
  right: 20px;
  bottom: 122px;
  padding: 6px 12px;
  border: 1px solid var(--ink);
  background: var(--surface);
  color: var(--ink);
  font-size: 10px;
  box-shadow: var(--shadow-sm);
}

.jump-btn:hover {
  background: var(--ink);
  color: #fff;
}

/* ============ 输入区 ============ */

.composer {
  border-top: 1px solid var(--line);
  padding: 10px 18px 14px;
  background: var(--surface);
}

.composer-lock {
  margin-bottom: 8px;
  padding: 7px 10px;
  border: 1px dashed var(--coral);
  background: var(--coral-tint);
  color: var(--coral-dark);
  font-size: 11px;
}

.composer-box {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.composer-input {
  flex: 1;
  min-height: 62px;
  max-height: 150px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}

.composer-input:focus {
  border-color: var(--ink);
}

.composer-input:disabled {
  background: var(--paper);
  color: var(--muted);
  cursor: not-allowed;
}

.composer-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.composer-count {
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 0.02em;
}

.composer-count.over {
  color: var(--coral-dark);
}

/* ============ 响应式 ============ */

@media (max-width: 880px) {
  .im-shell {
    grid-template-columns: minmax(0, 1fr);
    height: 68vh;
    min-height: 460px;
  }

  .chat-pane {
    display: none;
  }

  .im-shell.chat-open .conv-pane {
    display: none;
  }

  .im-shell.chat-open .chat-pane {
    display: flex;
  }

  .chat-back {
    display: grid;
    place-items: center;
  }

  /* 手机端进入对话后让出整屏空间：隐藏页头大标题，聊天区占满可视高度 */
  .messages-page.chat-open .page-header {
    display: none;
  }

  .messages-page.chat-open .im-shell {
    height: calc(100dvh - 132px);
    min-height: 420px;
  }
}

@media (max-width: 600px) {
  .messages-page {
    padding: 30px 0 48px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .chat-body {
    padding: 14px 14px 8px;
  }

  .msg-body {
    max-width: 80%;
  }

  .composer {
    padding: 8px 12px 12px;
  }

  .jump-btn {
    right: 12px;
    bottom: 128px;
  }
}
</style>
