import { onUnmounted, watch } from 'vue'

/**
 * 弹窗打开时锁定页面滚动，关闭或组件卸载时恢复。
 * 反馈相关弹窗共用，避免每个弹窗各写一遍 watch + onUnmounted。
 */
export function useBodyScrollLock(isLocked: () => boolean) {
  watch(
    isLocked,
    (locked) => {
      document.body.style.overflow = locked ? 'hidden' : ''
    },
    { immediate: true },
  )

  onUnmounted(() => {
    document.body.style.overflow = ''
  })
}
