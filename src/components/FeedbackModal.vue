<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { createFeedback } from '@/api/feedback'
import { uploadFiles } from '@/api/file'
import { useUiStore } from '@/stores/ui'
import { useUserStore } from '@/stores/user'
import {
  FEEDBACK_TYPE_HINTS,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPE_ORDER,
} from '@/constants/feedback'
import { useBodyScrollLock } from '@/composables/useBodyScrollLock'
import type { FeedbackType } from '@/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; created: [] }>()

const router = useRouter()

const ui = useUiStore()
const userStore = useUserStore()

/** 反馈类型选项：覆盖 Bug 与待优化，并预留新功能与其他 */
const TYPE_OPTIONS = FEEDBACK_TYPE_ORDER.map((value) => ({
  value,
  label: FEEDBACK_TYPE_LABELS[value],
  hint: FEEDBACK_TYPE_HINTS[value],
}))

const MAX_IMAGES = 5
const MAX_SIZE = 32 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const type = ref<FeedbackType>('bug')
const title = ref('')
const content = ref('')
const images = ref<string[]>([])
const pageUrl = ref('')
const contact = ref('')
const submitting = ref(false)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const errors = ref<{
  title?: string
  content?: string
}>({})

function resetForm() {
  type.value = 'bug'
  title.value = ''
  content.value = ''
  images.value = []
  // 自动带入当前页面地址，方便定位问题
  pageUrl.value = window.location.href
  contact.value = userStore.userInfo?.email || ''
  errors.value = {}
  submitting.value = false
  uploading.value = false
}

function onClose() {
  if (submitting.value) return
  emit('close')
}

/** 跳转反馈中心：提交后可以在这里查看进度与官方答复 */
function goCenter() {
  emit('close')
  router.push('/feedback')
}

function pickFiles() {
  fileInput.value?.click()
}

async function onFilesChange(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  input.value = ''
  if (!picked.length) return

  const rooms = MAX_IMAGES - images.value.length
  if (rooms <= 0) {
    ui.toastError(`最多上传 ${MAX_IMAGES} 张截图`)
    return
  }

  const valid: File[] = []
  for (const file of picked.slice(0, rooms)) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      ui.toastError(`${file.name} 不是支持的图片格式（仅 JPG / PNG / GIF / WebP）`)
      continue
    }
    if (file.size > MAX_SIZE) {
      ui.toastError(`${file.name} 超过 32MB`)
      continue
    }
    valid.push(file)
  }
  if (!valid.length) return

  uploading.value = true
  try {
    const uploaded = await uploadFiles(valid)
    uploaded.forEach((file) => {
      if (file.url && images.value.length < MAX_IMAGES && !images.value.includes(file.url)) {
        images.value.push(file.url)
      }
    })
    if (uploaded.length) ui.toast('截图上传成功')
  } catch (error: unknown) {
    ui.toastError(error instanceof Error ? error.message : '截图上传失败，请稍后重试')
  } finally {
    uploading.value = false
  }
}

function removeImage(index: number) {
  images.value.splice(index, 1)
}

function validate(): boolean {
  errors.value = {}
  if (!title.value.trim()) errors.value.title = '请填写反馈标题'
  else if (title.value.trim().length > 100) errors.value.title = '标题不能超过 100 字'
  if (!content.value.trim()) errors.value.content = '请描述遇到的问题或建议'
  else if (content.value.trim().length > 2000) errors.value.content = '描述不能超过 2000 字'
  return !Object.values(errors.value).some(Boolean)
}

async function submit() {
  if (!validate()) {
    ui.toastError('请检查表单填写是否完整')
    return
  }
  submitting.value = true
  try {
    await createFeedback({
      type: type.value,
      title: title.value.trim(),
      content: content.value.trim(),
      images: images.value,
      pageUrl: pageUrl.value.trim(),
      contact: contact.value.trim(),
    })
    ui.toast('反馈已提交，感谢你的建议')
    emit('created')
    emit('close')
  } catch (error: unknown) {
    ui.toastError(error instanceof Error ? error.message : '提交失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') onClose()
}

watch(
  () => props.open,
  (open) => {
    if (open) resetForm()
  },
)

useBodyScrollLock(() => props.open)

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="onClose">
      <div class="feedback-panel" role="dialog" aria-modal="true" aria-label="提交反馈">
        <header class="panel-head">
          <div>
            <span class="eyebrow">Feedback</span>
            <h2 class="panel-title">提交反馈</h2>
            <p class="panel-sub">问题、建议都可以，越具体越容易定位。</p>
          </div>
          <button class="close-btn" type="button" aria-label="关闭" @click="onClose">×</button>
        </header>

        <div class="panel-body">
          <div class="public-notice">
            提交后所有登录用户都能看到这条反馈并参与讨论。联系方式与页面地址仅管理员和你本人可见，但标题、正文和截图都会公开，请不要放账号、手机号、身份证号等信息。
          </div>

          <label class="field-label">反馈类型 <span class="required">*</span></label>
          <div class="type-grid">
            <button
              v-for="option in TYPE_OPTIONS"
              :key="option.value"
              :class="['type-card', { active: type === option.value }]"
              type="button"
              @click="type = option.value"
            >
              <strong>{{ option.label }}</strong>
              <span>{{ option.hint }}</span>
            </button>
          </div>

          <label class="field-label" for="feedback-title"
            >标题 <span class="required">*</span></label
          >
          <input
            id="feedback-title"
            v-model="title"
            class="field-input"
            type="text"
            maxlength="100"
            placeholder="一句话概括问题，例如「文章详情页封面图加载失败」"
          />
          <p v-if="errors.title" class="form-error">{{ errors.title }}</p>

          <label class="field-label" for="feedback-content"
            >详细描述 <span class="required">*</span></label
          >
          <textarea
            id="feedback-content"
            v-model="content"
            class="field-area"
            rows="5"
            maxlength="2000"
            placeholder="复现步骤、期望结果、实际结果；如果是建议，说明使用场景与希望的效果"
          ></textarea>
          <p class="counter">{{ content.length }} / 2000</p>
          <p v-if="errors.content" class="form-error">{{ errors.content }}</p>

          <label class="field-label">截图（选填，最多 {{ MAX_IMAGES }} 张）</label>
          <div class="shots">
            <figure v-for="(url, index) in images" :key="url" class="shot">
              <img :src="url" alt="反馈截图" />
              <button
                class="shot-remove"
                type="button"
                aria-label="移除截图"
                @click="removeImage(index)"
              >
                ×
              </button>
            </figure>
            <button
              v-if="images.length < MAX_IMAGES"
              class="shot-add"
              type="button"
              :disabled="uploading"
              @click="pickFiles"
            >
              <span class="shot-plus">{{ uploading ? '…' : '＋' }}</span>
              <span>{{ uploading ? '上传中' : '上传截图' }}</span>
            </button>
          </div>
          <input
            ref="fileInput"
            class="hidden-input"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            @change="onFilesChange"
          />
          <p class="form-hint">
            截图会先上传到本站文件服务，再随反馈一起保存；本机文件路径其他人无法访问，请不要直接粘贴本地路径。
          </p>

          <div class="field-grid">
            <label>
              <span class="field-label">页面地址</span>
              <input v-model="pageUrl" class="field-input" type="text" maxlength="500" />
            </label>
            <label>
              <span class="field-label">联系方式（选填）</span>
              <input
                v-model="contact"
                class="field-input"
                type="text"
                maxlength="64"
                placeholder="邮箱 / 微信，便于我们回访"
              />
            </label>
          </div>
        </div>

        <footer class="panel-foot">
          <div class="foot-left">
            <p class="foot-hint">1 分钟内仅可提交 1 条，24 小时最多 20 条。</p>
            <button class="text-button foot-link" type="button" @click="goCenter">
              查看我的反馈 →
            </button>
          </div>
          <div class="foot-actions">
            <button class="btn btn-outline btn-sm" type="button" @click="onClose">取消</button>
            <button
              class="btn btn-coral btn-sm"
              type="button"
              :disabled="submitting || uploading"
              @click="submit"
            >
              {{ submitting ? '提交中…' : '提交反馈' }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.feedback-panel {
  width: min(100%, 680px);
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
  padding: 26px 28px 0;
}

.panel-title {
  margin: 10px 0 6px;
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 30px;
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
  padding: 8px 28px 4px;
  overflow-y: auto;
}

.public-notice {
  margin: 4px 0 16px;
  padding: 10px 12px;
  border-left: 3px solid var(--coral);
  background: var(--paper);
  color: var(--muted);
  font-size: 11px;
  line-height: 1.7;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.type-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px 12px;
  border: 1px solid var(--line);
  background: var(--paper);
  text-align: left;
}

.type-card strong {
  font-size: 12px;
  font-weight: 700;
}

.type-card span {
  color: var(--muted);
  font-size: 10px;
  line-height: 1.4;
}

.type-card:hover {
  border-color: var(--coral);
}

.type-card.active {
  border-color: var(--coral);
  background: var(--coral-tint);
}

.type-card.active strong {
  color: var(--coral-dark);
}

.counter {
  margin: 6px 0 0;
  color: var(--muted);
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  text-align: right;
}

.shots {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.shot {
  position: relative;
  width: 92px;
  height: 92px;
  margin: 0;
  border: 1px solid var(--line);
  background: var(--paper);
}

.shot img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.shot-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  background: rgba(24, 34, 31, 0.72);
  color: #fff;
  font-size: 12px;
  line-height: 1;
}

.shot-add {
  width: 92px;
  height: 92px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px dashed var(--line);
  background: transparent;
  color: var(--muted);
  font-size: 10px;
}

.shot-add:hover:not(:disabled) {
  border-color: var(--coral);
  color: var(--coral-dark);
}

.shot-plus {
  font-size: 20px;
  line-height: 1;
}

.hidden-input {
  display: none;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-top: 16px;
}

.panel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding: 16px 28px 22px;
  border-top: 1px solid var(--line);
}

.foot-hint {
  margin: 0;
  color: var(--muted);
  font-size: 10px;
}

.foot-left {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.foot-link {
  align-self: flex-start;
  font-size: 11px;
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

  .type-grid,
  .field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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
