<script setup lang="ts">
import { computed } from 'vue'
import type { IMConversation } from '@/types/im'
import { initialOf } from '@/utils/format'
import { formatConversationTime, messageBriefPreview } from '@/utils/im'

const props = defineProps<{
  conversation: IMConversation
  active: boolean
  /** 当前登录用户 ID，用于把最后一条消息区分成「我：…」 */
  myId: number
}>()

const preview = computed(() => {
  const last = props.conversation.lastMessage
  if (!last) return '还没有消息，打个招呼吧'
  const prefix = last.senderId === props.myId ? '我：' : ''
  const body = messageBriefPreview(last)
  if (last.replyToContent && !last.recalled) return `${prefix}引用：${body}`
  return `${prefix}${body}`
})

const time = computed(() => formatConversationTime(props.conversation.lastMessageAt))
const badge = computed(() =>
  props.conversation.unread > 99 ? '99+' : String(props.conversation.unread),
)
</script>

<template>
  <button
    :class="['conv-item', { active, unread: conversation.unread > 0 }]"
    type="button"
    @click="$emit('select', conversation)"
  >
    <span class="conv-avatar">
      <img v-if="conversation.peer.avatar" :src="conversation.peer.avatar" :alt="conversation.peer.name" />
      <template v-else>{{ initialOf(conversation.peer.name) }}</template>
    </span>

    <span class="conv-main">
      <span class="conv-top">
        <span class="conv-name">{{ conversation.peer.name }}</span>
        <span class="conv-time">{{ time }}</span>
      </span>
      <span class="conv-bottom">
        <span class="conv-preview">{{ preview }}</span>
        <span v-if="conversation.unread > 0" class="conv-badge">{{ badge }}</span>
        <span v-else-if="conversation.status === 'stranger'" class="conv-tag">陌生</span>
      </span>
    </span>
  </button>
</template>

<style scoped>
.conv-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--line);
  background: transparent;
  text-align: left;
  transition: background 0.18s ease;
}

.conv-item:hover {
  background: rgba(24, 34, 31, 0.04);
}

.conv-item.active {
  background: var(--surface);
  box-shadow: inset 3px 0 0 var(--coral);
}

.conv-avatar {
  width: 40px;
  height: 40px;
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

.conv-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.conv-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.conv-top,
.conv-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conv-top {
  justify-content: space-between;
}

.conv-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 700;
}

.conv-time {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.02em;
}

.conv-bottom {
  justify-content: space-between;
}

.conv-preview {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11px;
}

.conv-item.unread .conv-preview {
  color: var(--ink);
}

.conv-badge {
  flex-shrink: 0;
  min-width: 18px;
  padding: 2px 5px;
  background: var(--coral);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.3;
  text-align: center;
}

.conv-tag {
  flex-shrink: 0;
  padding: 1px 5px;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 0.06em;
}
</style>
