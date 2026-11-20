<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { createFeedbackReply, getFeedbackReplies } from '@/api/feedback'
import { useUiStore } from '@/stores/ui'
import { FEEDBACK_STATUS_LABELS, FEEDBACK_TYPE_LABELS } from '@/constants/feedback'
import { useBodyScrollLock } from '@/composables/useBodyScrollLock'
import { formatDate, initialOf } from '@/utils/format'
import type { FeedbackListItem, FeedbackReply } from '@/types'

const PAGE_SIZE = 20

const props = defineProps<{ feedback: FeedbackListItem | null }>()
const emit = defineEmits<{ close: []; updated: [] }>()

const ui = useUiStore()

const replies = ref<FeedbackReply[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref('')
const content = ref('')
const submitting = ref(false)
const replyTo = ref<FeedbackReply | null>(null)
const listRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)

/**
 * 按父子关系归组后深度优先拍平：子回复紧跟它的父回复，不再按创建顺序平铺。
 * 否则子回复会落在"创建它时最后一条顶层回复"下面，看起来像挂错了对象。
 * 父回复不在当前页时按顶层展示；深度超过一层仍归到第一层缩进，避免过深。
 */
const items = computed(() => {
  const byId = new Map(replies.value.map((item) => [item.id, item]))
  const byParent = new Map<number, FeedbackReply[]>()

  for (const reply of replies.value) {
    const key = reply.parentId || 0
    const siblings = byParent.get(key)
    if (siblings) siblings.push(reply)
    else byParent.set(key, [reply])
  }

  const flat: Array<{ reply: FeedbackReply; parent: FeedbackReply | null; depth: number }> = []
  const visited = new Set<number>()

  function walk(parent: FeedbackReply | null, parentId: number, depth: number) {
    if (visited.has(parentId)) return
    visited.add(parentId)

    for (const reply of byParent.get(parentId) ?? []) {
      flat.push({ reply, parent, depth })
      walk(reply, reply.id, depth + 1)
    }
  }

  walk(null, 0, 0)

  // 父回复还没加载到的（分页翻到后面才出现），按顶层补齐，不能凭空消失
  for (const reply of replies.value) {
    if (!visited.has(reply.id) && reply.parentId) {
      flat.push({ reply, parent: byId.get(reply.parentId) ?? null, depth: 0 })
      walk(reply, reply.id, 1)
    }
  }

  return flat
})

const remaining = computed(() => Math.max(0, total.value - replies.value.length))
const canSubmit = computed(() => content.value.trim().length > 0 && !submitting.value)

function typeLabel(type: FeedbackListItem['type']) {
  return FEEDBACK_TYPE_LABELS[type] ?? type
}

function statusLabel(status: FeedbackListItem['status']) {
  return FEEDBACK_STATUS_LABELS[status] ?? status
}

/** 被回复内容的单行摘要，避免子回复离父回复太远时失去上下文 */
function excerpt(text: string, max = 60) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function resetState() {
  replies.value = []
  total.value = 0
  page.value = 1
  loading.value = false
  error.value = ''
  content.value = ''
  replyTo.value = null
}

function scrollToBottom() {
  const el = listRef.value
  if (el) el.scrollTop = el.scrollHeight
}

/** 首屏或重新加载后停在顶部，避免一进来就看到最后一条 */
function scrollToTop() {
  const el = listRef.value
  if (el) el.scrollTop = 0
}

/** 新回复会插到它的父回复下面，不是列表末尾，所以按 id 定位而不是滚到底 */
function scrollToReply(id: number) {
  const el = listRef.value
  const node = el?.querySelector<HTMLElement>(`[data-reply-id="${id}"]`)
  if (node) node.scrollIntoView({ block: 'nearest' })
  else scrollToBottom()
}

async function load(reset: boolean) {
  const target = props.feedback
  if (!target || loading.value === true) return
  if (reset) resetState()

  loading.value = true
  error.value = ''
  try {
    const res = await getFeedbackReplies(target.id, page.value, PAGE_SIZE)
    replies.value = reset ? res.list : [...replies.value, ...res.list]
    total.value = res.total
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : '回复加载失败，请稍后重试'
  } finally {
    loading.value = false
    await nextTick()
    if (reset) scrollToTop()
  }
}

async function loadMore() {
  if (loading.value || remaining.value === 0) return
  page.value += 1
  await load(false)
}

function pickReplyTarget(reply: FeedbackReply) {
  replyTo.value = reply
  nextTick(() => inputRef.value?.focus())
}

function clearReplyTarget() {
  replyTo.value = null
}

async function submit() {
  const target = props.feedback
  if (!target) return

  const text = content.value.trim()
  if (!text) {
    ui.toastError('回复内容不能为空')
    return
  }

  submitting.value = true
  try {
    const created = await createFeedbackReply({
      feedbackId: target.id,
      parentId: replyTo.value?.id ?? 0,
      content: text,
    })
    replies.value = [...replies.value, created]
    total.value += 1
    content.value = ''
    replyTo.value = null
    ui.toast('回复已发表')
    emit('updated')
    await nextTick()
    scrollToReply(created.id)
  } catch (err: unknown) {
    ui.toastError(err instanceof Error ? err.message : '回复失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

function onClose() {
  if (submitting.value) return
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (!props.feedback) return
  if (event.key === 'Escape') onClose()
}

watch(
  () => props.feedback,
  (feedback) => {
    if (!feedback) return
    load(true)
  },
  { immediate: true },
)

useBodyScrollLock(() => Boolean(props.feedback))

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="feedback" class="modal-backdrop" @click.self="onClose">
      <div class="discuss-panel" role="dialog" aria-modal="true" aria-label="反馈讨论">
        <header class="panel-head">
          <div>
            <span class="eyebrow">Discussion</span>
            <h2 class="panel-title">参与讨论</h2>
            <p class="panel-sub">反馈对所有人可见，讨论内容也会公开。</p>
          </div>
          <button class="close-btn" type="button" aria-label="关闭" @click="onClose">×</button>
        </header>

        <div class="panel-body">
          <div class="quote">
            <div class="quote-tags">
              <span :class="['type-tag', feedback?.type]">{{ typeLabel(feedback!.type) }}</span>
              <span :class="['status-pill', feedback?.status]">
                {{ statusLabel(feedback!.status) }}
              </span>
              <span v-if="feedback?.user" class="quote-user">
                来自 {{ feedback.user.name }} · {{ formatDate(feedback.createdAt, true) }}
              </span>
            </div>
            <h3 class="quote-title">{{ feedback?.title }}</h3>
            <p class="quote-content">{{ feedback?.content }}</p>
          </div>

          <div v-if="loading && !replies.length" class="state-block">
            <div class="spinner"></div>
            <p>正在读取讨论…</p>
          </div>
          <div v-else-if="error" class="state-block">
            <p class="state-title">加载遇到问题</p>
            <p>{{ error }}</p>
            <button class="text-button" type="button" style="margin-top: 12px" @click="load(true)">
              重新加载 →
            </button>
          </div>
          <template v-else>
            <p v-if="!items.length" class="empty-hint">还没有人回复，来说两句。</p>
            <ul v-else ref="listRef" class="reply-list">
              <li
                v-for="item in items"
                :key="item.reply.id"
                :data-reply-id="item.reply.id"
                :class="['reply-item', { nested: item.depth > 0, 'nested-deep': item.depth > 1 }]"
              >
                <span class="user-avatar">
                  <img
                    v-if="item.reply.user?.avatar"
                    :src="item.reply.user.avatar"
                    :alt="item.reply.user?.name"
                  />
                  <template v-else>{{ initialOf(item.reply.user?.name ?? '') }}</template>
                </span>
                <div class="reply-main">
                  <div class="reply-head">
                    <strong class="reply-name">{{ item.reply.user?.name ?? '匿名用户' }}</strong>
                    <span v-if="item.reply.isAdmin" class="official-tag">官方</span>
                    <time class="reply-time mono">{{
                      formatDate(item.reply.createdAt, true)
                    }}</time>
                    <button
                      class="text-button reply-action"
                      type="button"
                      @click="pickReplyTarget(item.reply)"
                    >
                      回复
                    </button>
                  </div>
                  <p v-if="item.parent" class="reply-parent">
                    回复
                    <strong class="reply-target">{{ item.parent.user?.name ?? '匿名用户' }}</strong>
                    ：{{ excerpt(item.parent.content) }}
                  </p>
                  <p class="reply-content">{{ item.reply.content }}</p>
                </div>
              </li>
            </ul>

            <button
              v-if="remaining > 0"
              class="btn btn-outline btn-sm load-more"
              type="button"
              :disabled="loading"
              @click="loadMore"
            >
              {{ loading ? '加载中…' : `加载更多（还有 ${remaining} 条）` }}
            </button>
          </template>
        </div>

        <footer class="panel-foot">
          <div v-if="replyTo" class="replying-hint">
            <span>正在回复 {{ replyTo.user?.name ?? '匿名用户' }}</span>
            <button class="text-button" type="button" @click="clearReplyTarget">取消</button>
          </div>
          <textarea
            ref="inputRef"
            v-model="content"
            class="field-area"
            rows="3"
            maxlength="1000"
            placeholder="补充复现信息、说明你的看法；请勿包含账号、手机号等敏感信息"
          ></textarea>
          <div class="foot-row">
            <p class="counter">{{ content.length }} / 1000</p>
            <div class="foot-actions">
              <button
                class="btn btn-outline btn-sm"
                type="button"
                :disabled="submitting"
                @click="onClose"
              >
                关闭
              </button>
              <button
                class="btn btn-coral btn-sm"
                type="button"
                :disabled="!canSubmit"
                @click="submit"
              >
                {{ submitting ? '发表中…' : '发表回复' }}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.discuss-panel {
  width: min(100%, 720px);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  box-shadow: var(--shadow);
  animation: modal-in 0.2s ease;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 26px 26px 0;
}

.panel-title {
  margin: 10px 0 6px;
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 28px;
  font-weight: 500;
}

.panel-sub {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.close-btn {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  font-size: 18px;
  line-height: 1;
}

.close-btn:hover {
  border-color: var(--ink);
  color: var(--ink);
}

.panel-body {
  padding: 16px 26px 4px;
  overflow-y: auto;
}

.quote {
  padding: 2px 0 12px;
  border-bottom: 1px solid var(--line);
}

.quote-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.type-tag {
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.type-tag.bug {
  background: var(--coral-tint);
  color: var(--coral-dark);
}

.type-tag.optimize {
  background: var(--lime);
  color: var(--lime-dark);
}

.type-tag.feature {
  background: var(--mint);
  color: var(--ink);
}

.type-tag.other {
  background: var(--paper);
  color: var(--muted);
}

.status-pill {
  padding: 4px 8px;
  border: 1px solid var(--line);
  font-size: 10px;
  font-weight: 700;
}

.status-pill.pending {
  border-color: var(--coral);
  color: var(--coral-dark);
}

.status-pill.processing {
  border-color: var(--lime-dark);
  color: var(--lime-dark);
}

.status-pill.resolved {
  border-color: var(--line);
  background: var(--paper);
  color: var(--ink);
}

.status-pill.ignored {
  color: var(--muted);
}

.quote-user {
  color: var(--muted);
  font-size: 10px;
}

.quote-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 700;
}

.quote-content {
  margin: 0;
  max-height: 8.5em;
  overflow-y: auto;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-hint {
  margin: 18px 0 6px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}

.reply-list {
  margin: 0;
  padding: 8px 0 0;
  list-style: none;
  max-height: 46vh;
  overflow-y: auto;
}

.reply-item {
  display: flex;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}

.reply-item.nested {
  margin-left: 26px;
  padding-left: 14px;
  border-left: 2px solid var(--coral-tint);
}

/* 二级及更深的回复再往里缩，避免和一层回复混在一起 */
.reply-item.nested.nested-deep {
  margin-left: 52px;
}

.user-avatar {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  overflow: hidden;
  background: var(--ink);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.reply-main {
  flex: 1;
  min-width: 0;
}

.reply-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.reply-name {
  font-size: 12px;
  font-weight: 700;
}

.official-tag {
  padding: 2px 6px;
  background: var(--coral-tint);
  color: var(--coral-dark);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
}

.reply-time {
  color: var(--muted);
  font-size: 10px;
}

.reply-action {
  margin-left: auto;
  font-size: 11px;
}

.reply-content {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 被回复的那句：单行截断，跟正文区分开，避免误读成回复内容 */
.reply-parent {
  margin: 6px 0 0;
  padding: 4px 8px;
  border-left: 2px solid var(--line);
  background: var(--paper);
  color: var(--muted);
  font-size: 10px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reply-target {
  color: var(--ink);
  font-weight: 700;
}

.load-more {
  margin: 14px 0 4px;
}

.panel-foot {
  margin-top: 12px;
  padding: 14px 26px 20px;
  border-top: 1px solid var(--line);
}

.replying-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  padding: 6px 10px;
  background: var(--paper);
  color: var(--muted);
  font-size: 11px;
}

.counter {
  margin: 6px 0 0;
  color: var(--muted);
  font-family: 'DM Mono', monospace;
  font-size: 10px;
}

.foot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.foot-actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 600px) {
  .panel-head,
  .panel-body,
  .panel-foot {
    padding-left: 18px;
    padding-right: 18px;
  }

  .foot-row {
    flex-direction: column;
    align-items: stretch;
  }

  .foot-actions {
    justify-content: flex-end;
  }
}
</style>
