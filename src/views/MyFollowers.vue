<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getFollowers } from '@/api/user'
import { useReactions } from '@/composables/useReactions'
import { useUserStore } from '@/stores/user'
import { useUiStore } from '@/stores/ui'
import type { FollowerItem } from '@/types'
import { formatNumber, initialOf } from '@/utils/format'

const userStore = useUserStore()
const ui = useUiStore()
const { isFollowed, toggleFollow, ensureReactions } = useReactions()

const items = ref<FollowerItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(true)
const errorMessage = ref('')
/** 头像加载失败的用户 ID 集合，失败后回退到首字母占位 */
const avatarError = ref<Record<number, boolean>>({})
/** 正在执行关注/取关的粉丝 ID，防止重复点击 */
const reactingId = ref(0)

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

/** 关注 / 取消关注粉丝；本人不可关注自己 */
async function onFollow(item: FollowerItem) {
  if (item.id === userStore.userInfo?.id || reactingId.value) return
  reactingId.value = item.id
  try {
    const nowFollowing = await toggleFollow(item.id)
    ui.toast(nowFollowing ? '已关注 ' + item.name : '已取消关注 ' + item.name)
  } catch (error: unknown) {
    ui.toastError(error instanceof Error ? error.message : '操作失败，请稍后重试')
  } finally {
    reactingId.value = 0
  }
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await getFollowers({ page: page.value, pageSize })
    items.value = res.list
    total.value = res.total
    avatarError.value = {}
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '粉丝列表加载失败，请稍后重试。'
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function changePage(next: number) {
  if (next < 1 || next > pages.value || next === page.value) return
  page.value = next
  load()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(async () => {
  // 页面直接刷新进入时，等待根组件恢复登录态后再加载
  if (!userStore.userInfo && userStore.isLoggedIn) await userStore.restoreSession()
  // 先同步关注状态，避免关注映射未加载时误判为「未关注」
  await ensureReactions().catch(() => {})
  load()
})
</script>

<template>
  <div class="followers-page">
    <header class="page-header">
      <span class="eyebrow">My followers</span>
      <h1>我的粉丝</h1>
      <p>共 {{ formatNumber(total) }} 位作者关注了你，感谢他们的支持。</p>
    </header>

    <div v-if="loading" class="state-block">
      <div class="spinner"></div>
      <p>正在读取粉丝…</p>
    </div>
    <div v-else-if="errorMessage" class="state-block">
      <p class="state-title">加载遇到问题</p>
      <p>{{ errorMessage }}</p>
      <button class="text-button" type="button" style="margin-top: 12px" @click="load">重新加载 →</button>
    </div>
    <template v-else-if="items.length">
      <ul class="followers-list">
        <li v-for="item in items" :key="item.id">
          <router-link
            class="followers-main"
            :to="{ name: 'user-profile', params: { id: item.id } }"
          >
            <span class="followers-avatar">
              <img
                v-if="item.avatar && !avatarError[item.id]"
                :src="item.avatar"
                :alt="item.name"
                loading="lazy"
                @error="avatarError[item.id] = true"
              />
              <template v-else>{{ initialOf(item.name) }}</template>
            </span>
            <span class="followers-name">{{ item.name || '未命名作者' }}</span>
          </router-link>
          <button
            v-if="item.id !== userStore.userInfo?.id"
            :class="['follow-btn', { active: isFollowed(item.id) }]"
            type="button"
            :disabled="reactingId === item.id"
            @click.stop="onFollow(item)"
          >
            {{ isFollowed(item.id) ? '✓ 已关注' : '＋ 关注' }}
          </button>
          <span v-else class="self-hint">这是你自己</span>
        </li>
      </ul>
      <div class="pagination">
        <button class="page-btn" type="button" :disabled="page <= 1" @click="changePage(page - 1)">← 上一页</button>
        <span class="page-info">{{ page }} / {{ pages }}</span>
        <button class="page-btn" type="button" :disabled="page >= pages" @click="changePage(page + 1)">
          下一页 →
        </button>
      </div>
    </template>
    <div v-else class="state-block empty-state">
      <p class="state-title">还没有粉丝</p>
      <p>把文章分享出去，吸引更多读者关注你吧。</p>
      <router-link class="btn btn-coral" :to="{ name: 'articles' }" style="margin-top: 18px">
        去看看文章 →
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.followers-page {
  padding: 48px 0 80px;
}

.page-header {
  margin-bottom: 30px;
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

.followers-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line);
}

.followers-list li {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}

.followers-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.followers-avatar {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  overflow: hidden;
  background: var(--coral);
  color: #fff;
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 16px;
}

.followers-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.followers-name {
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.followers-main:hover .followers-name {
  color: var(--coral-dark);
}

.follow-btn {
  flex-shrink: 0;
  padding: 7px 14px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font-size: 11px;
  font-weight: 700;
}

.follow-btn:hover:not(:disabled) {
  border-color: var(--coral-dark);
  color: var(--coral-dark);
}

.follow-btn.active {
  border-color: var(--coral);
  background: var(--coral-tint);
  color: var(--coral-dark);
}

.follow-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.self-hint {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 11px;
}

.empty-state {
  border: 1px dashed var(--line);
  background: var(--surface);
  margin-top: 10px;
}

@media (max-width: 600px) {
  .followers-list li {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
</style>
