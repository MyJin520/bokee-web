<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FeedbackListItem, FeedbackStatus, FeedbackType } from '@/types'
import { FEEDBACK_STATUS_LABELS, FEEDBACK_TYPE_LABELS } from '@/constants/feedback'
import { formatDate, initialOf } from '@/utils/format'

const props = defineProps<{
  feedback: FeedbackListItem
  /** 全部反馈页展示提交者 */
  showAuthor?: boolean
  /** 是否展示联系方式（仅管理员 / 本人可见的数据才会返回） */
  showContact?: boolean
  /** 管理员操作区：处理 / 删除 */
  manageable?: boolean
}>()

const emit = defineEmits<{
  handle: [feedback: FeedbackListItem]
  remove: [feedback: FeedbackListItem]
}>()

const expanded = ref(false)
const brokenUrls = ref<string[]>([])

const images = computed(() => props.feedback.images ?? [])
const needExpand = computed(() => props.feedback.content.length > 140)

function typeLabel(type: FeedbackType) {
  return FEEDBACK_TYPE_LABELS[type] ?? type
}

function statusLabel(status: FeedbackStatus) {
  return FEEDBACK_STATUS_LABELS[status] ?? status
}

function markBroken(url: string) {
  if (!brokenUrls.value.includes(url)) brokenUrls.value = [...brokenUrls.value, url]
}
</script>

<template>
  <article class="feedback-card">
    <div class="card-top">
      <span :class="['type-tag', feedback.type]">{{ typeLabel(feedback.type) }}</span>
      <span :class="['status-pill', feedback.status]">{{ statusLabel(feedback.status) }}</span>
      <span v-if="showAuthor && feedback.user" class="card-user">
        <span class="user-avatar">
          <img v-if="feedback.user.avatar" :src="feedback.user.avatar" :alt="feedback.user.name" />
          <template v-else>{{ initialOf(feedback.user.name) }}</template>
        </span>
        {{ feedback.user.name }}
      </span>
      <time class="card-time mono">{{ formatDate(feedback.createdAt, true) }}</time>
    </div>

    <h2 class="card-title">{{ feedback.title }}</h2>
    <p :class="['card-content', { clamped: !expanded }]">{{ feedback.content }}</p>
    <button
      v-if="needExpand"
      class="text-button expand-btn"
      type="button"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起 ↑' : '展开全文 ↓' }}
    </button>

    <div v-if="images.length" class="shots">
      <template v-for="url in images" :key="url">
        <a
          v-if="!brokenUrls.includes(url)"
          class="shot"
          :href="url"
          target="_blank"
          rel="noreferrer"
        >
          <img :src="url" alt="反馈截图" loading="lazy" @error="markBroken(url)" />
        </a>
        <span v-else class="shot shot-broken">截图无法加载</span>
      </template>
    </div>

    <div v-if="feedback.reply" class="reply-block">
      <span class="reply-label">官方回复</span>
      <p class="reply-text">{{ feedback.reply }}</p>
      <time v-if="feedback.repliedAt" class="reply-time mono">
        {{ formatDate(feedback.repliedAt, true) }}
      </time>
    </div>

    <div v-if="feedback.pageUrl || (showContact && feedback.contact)" class="card-meta">
      <p v-if="feedback.pageUrl">页面：{{ feedback.pageUrl }}</p>
      <p v-if="showContact && feedback.contact">联系方式：{{ feedback.contact }}</p>
    </div>

    <div v-if="manageable" class="card-actions">
      <button class="row-action" type="button" @click="emit('handle', feedback)">
        处理 / 回复
      </button>
      <button class="row-action danger" type="button" @click="emit('remove', feedback)">
        删除
      </button>
    </div>
  </article>
</template>

<style scoped>
.feedback-card {
  padding: 20px 22px;
  border: 1px solid var(--line);
  background: var(--surface);
}

.card-top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
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

.card-user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 4px;
  color: var(--muted);
  font-size: 11px;
}

.user-avatar {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  overflow: hidden;
  background: var(--ink);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-time {
  margin-left: auto;
  color: var(--muted);
  font-size: 10px;
}

.card-title {
  margin: 0 0 8px;
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 23px;
  font-weight: 500;
  line-height: 1.3;
}

.card-content {
  margin: 0;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
}

.card-content.clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
}

.expand-btn {
  margin-top: 6px;
}

.shots {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.shot {
  width: 108px;
  height: 78px;
  display: block;
  border: 1px solid var(--line);
  overflow: hidden;
  background: var(--paper);
}

.shot img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.shot-broken {
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 10px;
  text-align: center;
}

.reply-block {
  margin-top: 14px;
  padding: 12px 14px;
  border-left: 3px solid var(--coral);
  background: var(--paper);
}

.reply-label {
  color: var(--coral-dark);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.reply-text {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.reply-time {
  display: block;
  margin-top: 6px;
  color: var(--muted);
  font-size: 10px;
}

.card-meta {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 11px;
  word-break: break-all;
}

.card-meta p {
  margin: 2px 0;
}

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.row-action {
  padding: 7px 12px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font-size: 11px;
  font-weight: 700;
}

.row-action:hover {
  border-color: var(--ink);
}

.row-action.danger {
  color: var(--color-danger);
}

.row-action.danger:hover {
  border-color: var(--color-danger);
  background: var(--color-danger);
  color: #fff;
}

@media (max-width: 600px) {
  .feedback-card {
    padding: 16px;
  }

  .card-time {
    margin-left: 0;
    width: 100%;
  }
}
</style>
