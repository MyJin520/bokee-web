<script setup lang="ts">
import { ref, watch } from 'vue'
import { updateFeedback } from '@/api/feedback'
import { useUiStore } from '@/stores/ui'
import {
  FEEDBACK_STATUS_HINTS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUS_ORDER,
} from '@/constants/feedback'
import { useBodyScrollLock } from '@/composables/useBodyScrollLock'
import type { FeedbackListItem, FeedbackStatus } from '@/types'

const props = defineProps<{ feedback: FeedbackListItem | null }>()
const emit = defineEmits<{ close: []; updated: [] }>()

const ui = useUiStore()

const STATUS_OPTIONS = FEEDBACK_STATUS_ORDER.map((value) => ({
  value,
  label: FEEDBACK_STATUS_LABELS[value],
  hint: FEEDBACK_STATUS_HINTS[value],
}))

/** 常用回复模板，减少重复输入 */
const REPLY_TEMPLATES = [
  '已收到，正在排查，有结论会同步给你。',
  '已修复并上线，感谢你的反馈。',
  '这个建议已记录，会排进后续迭代。',
]

const status = ref<FeedbackStatus>('pending')
const reply = ref('')
const submitting = ref(false)

watch(
  () => props.feedback,
  (feedback) => {
    if (!feedback) return
    status.value = feedback.status
    reply.value = feedback.reply || ''
  },
  { immediate: true },
)

useBodyScrollLock(() => Boolean(props.feedback))

function applyTemplate(text: string) {
  reply.value = reply.value.trim() ? `${reply.value.trim()}\n${text}` : text
}

function onClose() {
  if (submitting.value) return
  emit('close')
}

async function submit() {
  const target = props.feedback
  if (!target) return
  submitting.value = true
  try {
    await updateFeedback({
      id: target.id,
      status: status.value,
      reply: reply.value.trim(),
    })
    ui.toast('反馈已更新')
    emit('updated')
    emit('close')
  } catch (error: unknown) {
    ui.toastError(error instanceof Error ? error.message : '更新失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="feedback" class="modal-backdrop" @click.self="onClose">
      <div class="handle-panel" role="dialog" aria-modal="true" aria-label="处理反馈">
        <header class="panel-head">
          <div>
            <span class="eyebrow">Admin · feedback</span>
            <h2 class="panel-title">处理反馈</h2>
          </div>
          <button class="close-btn" type="button" aria-label="关闭" @click="onClose">×</button>
        </header>

        <div class="panel-body">
          <div class="quote">
            <span class="quote-title">{{ feedback?.title }}</span>
            <p class="quote-content">{{ feedback?.content }}</p>
            <span v-if="feedback?.user" class="quote-user">来自 {{ feedback.user.name }}</span>
          </div>

          <label class="field-label">处理状态</label>
          <div class="status-grid">
            <button
              v-for="option in STATUS_OPTIONS"
              :key="option.value"
              :class="['status-card', { active: status === option.value }]"
              type="button"
              @click="status = option.value"
            >
              <strong>{{ option.label }}</strong>
              <span>{{ option.hint }}</span>
            </button>
          </div>

          <label class="field-label" for="feedback-reply">回复用户</label>
          <textarea
            id="feedback-reply"
            v-model="reply"
            class="field-area"
            rows="4"
            maxlength="2000"
            placeholder="写下处理结论，提交者会在「我的反馈」里看到"
          ></textarea>
          <p class="counter">{{ reply.length }} / 2000</p>

          <div class="templates">
            <button
              v-for="text in REPLY_TEMPLATES"
              :key="text"
              class="template-chip"
              type="button"
              @click="applyTemplate(text)"
            >
              {{ text }}
            </button>
          </div>
        </div>

        <footer class="panel-foot">
          <p class="foot-hint">回复会记录回复人与时间，提交者可见。</p>
          <div class="foot-actions">
            <button class="btn btn-outline btn-sm" type="button" @click="onClose">取消</button>
            <button
              class="btn btn-coral btn-sm"
              type="button"
              :disabled="submitting"
              @click="submit"
            >
              {{ submitting ? '保存中…' : '保存处理结果' }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.handle-panel {
  width: min(100%, 560px);
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
  margin: 10px 0 0;
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 28px;
  font-weight: 500;
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
  padding: 12px 14px;
  border-left: 3px solid var(--coral);
  background: var(--paper);
}

.quote-title {
  font-size: 12px;
  font-weight: 700;
}

.quote-content {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.quote-user {
  display: inline-block;
  margin-top: 8px;
  color: var(--muted);
  font-size: 10px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.status-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  background: var(--paper);
  text-align: left;
}

.status-card strong {
  font-size: 12px;
  font-weight: 700;
}

.status-card span {
  color: var(--muted);
  font-size: 10px;
}

.status-card:hover {
  border-color: var(--coral);
}

.status-card.active {
  border-color: var(--coral);
  background: var(--coral-tint);
}

.status-card.active strong {
  color: var(--coral-dark);
}

.counter {
  margin: 6px 0 0;
  color: var(--muted);
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  text-align: right;
}

.templates {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.template-chip {
  padding: 6px 9px;
  border: 1px dashed var(--line);
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  text-align: left;
}

.template-chip:hover {
  border-color: var(--coral);
  color: var(--coral-dark);
}

.panel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding: 14px 26px 20px;
  border-top: 1px solid var(--line);
}

.foot-hint {
  margin: 0;
  color: var(--muted);
  font-size: 10px;
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

  .panel-foot {
    flex-direction: column;
    align-items: stretch;
  }

  .foot-actions {
    justify-content: flex-end;
  }
}
</style>
