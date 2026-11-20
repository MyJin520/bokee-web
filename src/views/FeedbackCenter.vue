<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  deleteFeedback,
  exportFeedbackCsv,
  getFeedbackList,
  getFeedbackSummary,
  getMyFeedbackList,
} from '@/api/feedback'
import { useUserStore } from '@/stores/user'
import { useUiStore } from '@/stores/ui'
import type { FeedbackListItem, FeedbackStatus, FeedbackSummary } from '@/types'
import { formatNumber } from '@/utils/format'
import {
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUS_ORDER,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPE_ORDER,
} from '@/constants/feedback'
import FeedbackModal from '@/components/FeedbackModal.vue'
import FeedbackHandleModal from '@/components/FeedbackHandleModal.vue'
import FeedbackCard from '@/components/FeedbackCard.vue'
import FeedbackReplyPanel from '@/components/FeedbackReplyPanel.vue'

const userStore = useUserStore()
const ui = useUiStore()

type TabKey = 'mine' | 'all'

const PAGE_SIZE = 10

const TYPE_OPTIONS = [
  { label: '全部类型', value: '' },
  ...FEEDBACK_TYPE_ORDER.map((value) => ({ label: FEEDBACK_TYPE_LABELS[value], value })),
]

const STATUS_OPTIONS = [
  { label: '全部状态', value: '' },
  ...FEEDBACK_STATUS_ORDER.map((value) => ({ label: FEEDBACK_STATUS_LABELS[value], value })),
]

const activeTab = ref<TabKey>('mine')
const submitOpen = ref(false)
const handleTarget = ref<FeedbackListItem | null>(null)
const discussTarget = ref<FeedbackListItem | null>(null)

const mineList = ref<FeedbackListItem[]>([])
const mineTotal = ref(0)
const minePage = ref(1)
const mineLoading = ref(false)
const mineError = ref('')

const allList = ref<FeedbackListItem[]>([])
const allTotal = ref(0)
const allPage = ref(1)
const allLoading = ref(false)
const allError = ref('')
const filters = ref({ type: '', status: '', keyword: '' })

const summary = ref<FeedbackSummary | null>(null)
const exporting = ref(false)

const isAdmin = computed(() => userStore.isAdmin)
const minePages = computed(() => Math.max(1, Math.ceil(mineTotal.value / PAGE_SIZE)))
const allPages = computed(() => Math.max(1, Math.ceil(allTotal.value / PAGE_SIZE)))

function statusCount(key: FeedbackStatus): number {
  const item = (summary.value?.byStatus ?? []).find((entry) => entry.key === key)
  return item?.count ?? 0
}

async function loadMine() {
  mineLoading.value = true
  mineError.value = ''
  try {
    const res = await getMyFeedbackList(minePage.value, PAGE_SIZE)
    mineList.value = res.list
    mineTotal.value = res.total
  } catch (error: unknown) {
    mineList.value = []
    mineTotal.value = 0
    mineError.value = error instanceof Error ? error.message : '反馈加载失败，请稍后重试。'
  } finally {
    mineLoading.value = false
  }
}

async function loadAll() {
  allLoading.value = true
  allError.value = ''
  try {
    const res = await getFeedbackList({
      type: filters.value.type,
      status: filters.value.status,
      keyword: filters.value.keyword.trim(),
      page: allPage.value,
      pageSize: PAGE_SIZE,
    })
    allList.value = res.list
    allTotal.value = res.total
  } catch (error: unknown) {
    allList.value = []
    allTotal.value = 0
    allError.value = error instanceof Error ? error.message : '反馈加载失败，请稍后重试。'
  } finally {
    allLoading.value = false
  }
}

async function loadSummary() {
  if (!isAdmin.value) return
  try {
    summary.value = await getFeedbackSummary()
  } catch {
    // 统计只用于展示，失败不阻断列表
    summary.value = null
  }
}

/** 提交、处理、删除后统一刷新当前视角 */
function refreshCurrent() {
  if (activeTab.value === 'mine') {
    loadMine()
    return
  }
  loadAll()
  loadSummary()
}

function switchTab(tab: TabKey) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  refreshCurrent()
}

function searchAll() {
  allPage.value = 1
  loadAll()
}

function resetFilters() {
  filters.value = { type: '', status: '', keyword: '' }
  allPage.value = 1
  loadAll()
}

function changeMinePage(next: number) {
  if (next < 1 || next > minePages.value || next === minePage.value) return
  minePage.value = next
  loadMine()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function changeAllPage(next: number) {
  if (next < 1 || next > allPages.value || next === allPage.value) return
  allPage.value = next
  loadAll()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function openHandle(feedback: FeedbackListItem) {
  handleTarget.value = feedback
}

function openDiscuss(feedback: FeedbackListItem) {
  discussTarget.value = feedback
}

async function removeFeedback(feedback: FeedbackListItem) {
  const ok = await ui.confirm({
    title: '删除反馈',
    message: `确定删除「${feedback.title}」吗？删除后不可恢复。`,
    confirmText: '确认删除',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteFeedback(feedback.id)
    ui.toast('反馈已删除')
    if (allList.value.length === 1 && allPage.value > 1) allPage.value -= 1
    refreshCurrent()
  } catch (error: unknown) {
    ui.toastError(error instanceof Error ? error.message : '删除失败，请稍后重试')
  }
}

async function exportCsv() {
  exporting.value = true
  try {
    const blob = await exportFeedbackCsv({
      type: filters.value.type,
      status: filters.value.status,
      keyword: filters.value.keyword.trim(),
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = '用户反馈.csv'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
    ui.toast('已导出 CSV')
  } catch (error: unknown) {
    ui.toastError(error instanceof Error ? error.message : '导出失败，请稍后重试')
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  // 页面直接刷新进入时，等待根组件恢复登录态后再判断权限
  if (!userStore.userInfo && userStore.isLoggedIn) await userStore.restoreSession()
  activeTab.value = isAdmin.value ? 'all' : 'mine'
  refreshCurrent()
})
</script>

<template>
  <div class="feedback-page">
    <header class="page-header">
      <div>
        <span class="eyebrow">Feedback</span>
        <h1>反馈中心</h1>
        <p>Bug、待优化、新功能建议都可以提交；反馈对所有人可见，可以一起讨论，管理员负责处理。</p>
      </div>
      <button class="btn btn-coral" type="button" @click="submitOpen = true">＋ 提交反馈</button>
    </header>

    <div class="tabs" role="tablist">
      <button
        :class="['tab', { active: activeTab === 'mine' }]"
        type="button"
        role="tab"
        @click="switchTab('mine')"
      >
        我的反馈
      </button>
      <button
        :class="['tab', { active: activeTab === 'all' }]"
        type="button"
        role="tab"
        @click="switchTab('all')"
      >
        全部反馈
      </button>
    </div>

    <!-- 我的反馈 -->
    <section v-if="activeTab === 'mine'" class="tab-panel">
      <div v-if="mineLoading" class="state-block">
        <div class="spinner"></div>
        <p>正在读取你的反馈…</p>
      </div>
      <div v-else-if="mineError" class="state-block">
        <p class="state-title">加载遇到问题</p>
        <p>{{ mineError }}</p>
        <button class="text-button" type="button" style="margin-top: 12px" @click="loadMine">
          重新加载 →
        </button>
      </div>
      <template v-else-if="mineList.length">
        <div class="feedback-list">
          <FeedbackCard
            v-for="feedback in mineList"
            :key="feedback.id"
            :feedback="feedback"
            @discuss="openDiscuss"
          />
        </div>
        <div class="pagination">
          <button
            class="page-btn"
            type="button"
            :disabled="minePage <= 1"
            @click="changeMinePage(minePage - 1)"
          >
            ← 上一页
          </button>
          <span class="page-info">{{ minePage }} / {{ minePages }}</span>
          <button
            class="page-btn"
            type="button"
            :disabled="minePage >= minePages"
            @click="changeMinePage(minePage + 1)"
          >
            下一页 →
          </button>
        </div>
      </template>
      <div v-else class="state-block empty-state">
        <p class="state-title">还没有提交过反馈</p>
        <p>遇到问题或有改进想法，随手写下来，我们会逐条看。</p>
        <button
          class="btn btn-coral"
          type="button"
          style="margin-top: 18px"
          @click="submitOpen = true"
        >
          提交第一条反馈 →
        </button>
      </div>
    </section>

    <!-- 全部反馈 -->
    <section v-else class="tab-panel">
      <div v-if="isAdmin && summary" class="summary-row">
        <div class="stat">
          <span class="stat-num">{{ formatNumber(summary.total) }}</span>
          <span class="stat-label">总反馈</span>
        </div>
        <div class="stat">
          <span class="stat-num">{{ formatNumber(statusCount('pending')) }}</span>
          <span class="stat-label">待处理</span>
        </div>
        <div class="stat">
          <span class="stat-num">{{ formatNumber(statusCount('processing')) }}</span>
          <span class="stat-label">处理中</span>
        </div>
        <div class="stat">
          <span class="stat-num">{{ formatNumber(statusCount('resolved')) }}</span>
          <span class="stat-label">已解决</span>
        </div>
      </div>

      <form class="filter-bar" @submit.prevent="searchAll">
        <label class="filter-field">
          <span class="field-label">类型</span>
          <select v-model="filters.type" class="field-input">
            <option v-for="option in TYPE_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="filter-field">
          <span class="field-label">状态</span>
          <select v-model="filters.status" class="field-input">
            <option v-for="option in STATUS_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="filter-field filter-keyword">
          <span class="field-label">关键词</span>
          <input
            v-model="filters.keyword"
            class="field-input"
            type="text"
            placeholder="标题或内容"
          />
        </label>
        <div class="filter-actions">
          <button class="btn btn-coral btn-sm" type="submit" :disabled="allLoading">搜索</button>
          <button
            class="btn btn-outline btn-sm"
            type="button"
            :disabled="allLoading"
            @click="resetFilters"
          >
            重置
          </button>
          <button
            v-if="isAdmin"
            class="btn btn-outline btn-sm"
            type="button"
            :disabled="exporting || allLoading"
            @click="exportCsv"
          >
            {{ exporting ? '导出中…' : '导出 CSV' }}
          </button>
        </div>
      </form>

      <div v-if="allLoading" class="state-block">
        <div class="spinner"></div>
        <p>正在读取反馈…</p>
      </div>
      <div v-else-if="allError" class="state-block">
        <p class="state-title">加载遇到问题</p>
        <p>{{ allError }}</p>
        <button class="text-button" type="button" style="margin-top: 12px" @click="loadAll">
          重新加载 →
        </button>
      </div>
      <template v-else-if="allList.length">
        <div class="feedback-list">
          <FeedbackCard
            v-for="feedback in allList"
            :key="feedback.id"
            :feedback="feedback"
            show-author
            show-contact
            :manageable="isAdmin"
            @handle="openHandle"
            @remove="removeFeedback"
            @discuss="openDiscuss"
          />
        </div>
        <div class="pagination">
          <button
            class="page-btn"
            type="button"
            :disabled="allPage <= 1"
            @click="changeAllPage(allPage - 1)"
          >
            ← 上一页
          </button>
          <span class="page-info">{{ allPage }} / {{ allPages }}</span>
          <button
            class="page-btn"
            type="button"
            :disabled="allPage >= allPages"
            @click="changeAllPage(allPage + 1)"
          >
            下一页 →
          </button>
        </div>
      </template>
      <div v-else class="state-block empty-state">
        <p class="state-title">暂时没有反馈</p>
        <p>换个筛选条件，或成为第一个提建议的人。</p>
        <button
          class="btn btn-coral"
          type="button"
          style="margin-top: 18px"
          @click="submitOpen = true"
        >
          提交反馈 →
        </button>
      </div>
    </section>

    <FeedbackModal :open="submitOpen" @close="submitOpen = false" @created="refreshCurrent" />
    <FeedbackHandleModal
      :feedback="handleTarget"
      @close="handleTarget = null"
      @updated="refreshCurrent"
    />
    <FeedbackReplyPanel
      :feedback="discussTarget"
      @close="discussTarget = null"
      @updated="refreshCurrent"
    />
  </div>
</template>

<style scoped>
.feedback-page {
  padding: 48px 0 80px;
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 26px;
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

.tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 14px;
}

.tab {
  padding: 9px 16px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.tab:hover {
  border-color: var(--ink);
  color: var(--ink);
}

.tab.active {
  border-color: var(--ink);
  background: var(--ink);
  color: #fff;
}

.tab-panel {
  padding-top: 22px;
}

.summary-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-bottom: 18px;
  background: var(--line);
  border: 1px solid var(--line);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px 18px;
  background: var(--surface);
}

.stat-num {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 26px;
  line-height: 1.1;
}

.stat-label {
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.filter-bar {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(0, 2fr) auto;
  align-items: end;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--line);
  background: var(--surface);
}

.filter-field {
  display: block;
}

.filter-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.feedback-list {
  display: grid;
  gap: 14px;
  margin-top: 18px;
}

.empty-state {
  border: 1px dashed var(--line);
  background: var(--surface);
  margin-top: 18px;
}

@media (max-width: 900px) {
  .filter-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filter-keyword {
    grid-column: span 2;
  }
}

@media (max-width: 600px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .summary-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filter-bar {
    grid-template-columns: minmax(0, 1fr);
  }

  .filter-keyword {
    grid-column: auto;
  }
}
</style>
