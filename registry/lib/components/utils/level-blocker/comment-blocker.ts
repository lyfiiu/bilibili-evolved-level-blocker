import {
  CommentItem,
  CommentReplyItem,
  forEachCommentItem,
} from '@/components/utils/comment-apis'
import { getUID } from '@/core/utils'
import { LevelService } from './level-service'
import { HideMode, LevelBlockerOptions, parseWhitelistUids } from './options'

export const BLOCKED_CLASS = 'be-level-blocked'
export const COLLAPSED_CLASS = 'be-level-blocked-collapsed'
export const TEMP_SHOW_CLASS = 'be-level-temp-show'
export const FORCE_SHOW_CLASS = 'be-level-force-show'
export const SHOW_ALL_CLASS = 'be-level-blocker-show-all'

const COMMENT_EVAL_TOKEN_ATTR = 'data-be-level-comment-eval'

export class CommentBlocker {
  private trackedItems = new Set<CommentReplyItem>()
  private initialized = false
  private active = false
  private currentOptions: LevelBlockerOptions
  private whitelist = new Set<string>()
  private ownUid = ''
  private onStatsChange?: () => void
  private blockedCount = 0
  private forceShowAll = false

  constructor(
    private levelService: LevelService,
    initialOptions: LevelBlockerOptions,
    onStatsChange?: () => void,
  ) {
    this.currentOptions = initialOptions
    this.whitelist = parseWhitelistUids(initialOptions.whitelistUids)
    this.ownUid = getUID() || ''
    this.onStatsChange = onStatsChange
  }

  start() {
    this.active = true
    if (!this.initialized) {
      this.initialized = true
      forEachCommentItem({
        added: commentItem => {
          this.handleTopCommentAdded(commentItem)
        },
        removed: commentItem => {
          this.handleTopCommentRemoved(commentItem)
        },
      })
    }
    this.reEvaluateAll()
  }

  stop() {
    this.active = false
    this.trackedItems.forEach(item => {
      this.clearItemState(item.element)
    })
    this.updateBlockedCount()
  }

  updateOptions(nextOptions: LevelBlockerOptions) {
    this.currentOptions = nextOptions
    this.whitelist = parseWhitelistUids(nextOptions.whitelistUids)
    this.reEvaluateAll()
  }

  getBlockedCount() {
    return this.blockedCount
  }

  setForceShowAll(showAll: boolean) {
    this.forceShowAll = showAll
    this.trackedItems.forEach(item => {
      if (item.element?.isConnected) {
        item.element.classList.toggle(
          FORCE_SHOW_CLASS,
          showAll &&
            (item.element.classList.contains(BLOCKED_CLASS) ||
              item.element.classList.contains(COLLAPSED_CLASS)),
        )
      }
    })
  }

  reEvaluateAll() {
    if (!this.active) {
      return
    }
    this.trackedItems.forEach(item => {
      if (!item.element?.isConnected) {
        this.trackedItems.delete(item)
        return
      }
      this.evaluateReplyItem(item)
    })
    this.updateBlockedCount()
  }

  private handleTopCommentAdded(commentItem: CommentItem) {
    this.registerReplyItem(commentItem)
    commentItem.replies.forEach(reply => {
      this.registerReplyItem(reply)
    })
    commentItem.addEventListener('repliesUpdate', event => {
      const updatedReplies = (event as CustomEvent<CommentReplyItem[]>).detail ?? []
      updatedReplies.forEach(reply => {
        this.registerReplyItem(reply)
      })
      this.updateBlockedCount()
    })
    this.updateBlockedCount()
  }

  private handleTopCommentRemoved(commentItem: CommentItem) {
    if (commentItem) {
      this.trackedItems.delete(commentItem)
      commentItem.replies?.forEach(reply => {
        this.trackedItems.delete(reply)
      })
      this.updateBlockedCount()
    }
  }

  private registerReplyItem(item: CommentReplyItem) {
    if (!item?.element) {
      return
    }
    this.trackedItems.add(item)
    this.bindCollapseToggle(item.element)
    if (this.active) {
      this.evaluateReplyItem(item)
    }
  }

  private bindCollapseToggle(element: HTMLElement) {
    if (element.dataset.beLevelToggleBound === '1') {
      return
    }
    element.dataset.beLevelToggleBound = '1'
    element.addEventListener('click', event => {
      if (!element.classList.contains(COLLAPSED_CLASS)) {
        return
      }
      if (!element.classList.contains(TEMP_SHOW_CLASS)) {
        event.preventDefault()
        event.stopPropagation()
        element.classList.add(TEMP_SHOW_CLASS)
      }
    })
  }

  private extractLevelSync(item: CommentReplyItem): number | null {
    const props = item.frameworkSpecificProps as Record<string, unknown> | undefined
    const member = props?.member as Record<string, unknown> | undefined
    const levelInfo = member?.level_info as Record<string, unknown> | undefined
    if (levelInfo?.current_level !== undefined) {
      const level = Number(levelInfo.current_level)
      if (Number.isInteger(level) && level >= 0 && level <= 6) {
        this.levelService.recordLevel(item.userId, level)
        return level
      }
    }
    if (typeof member?.following === 'number' && member.following > 0) {
      this.levelService.recordFollowing(item.userId, true)
    }
    // 兼容 V1 DOM 评论区等级图标 class="level l3"
    const levelEl = item.element.querySelector('.user .level, .user i[class*="l"]')
    if (levelEl) {
      const match = levelEl.className.match(/\bl([0-6])\b/)
      if (match) {
        const level = Number(match[1])
        this.levelService.recordLevel(item.userId, level)
        return level
      }
    }
    return this.levelService.getCachedLevel(item.userId)
  }

  private async evaluateReplyItem(item: CommentReplyItem) {
    const { element, userId } = item
    if (!element?.isConnected) {
      return
    }
    const mid = userId ? String(userId) : ''
    if (
      !this.active ||
      !this.currentOptions.blockComments ||
      this.currentOptions.minCommentLevel <= 0
    ) {
      this.clearItemState(element)
      return
    }
    if (!mid || (this.ownUid && mid === this.ownUid) || this.whitelist.has(mid)) {
      this.clearItemState(element)
      return
    }
    if (this.currentOptions.whitelistFollowing && this.levelService.isFollowing(mid)) {
      this.clearItemState(element)
      return
    }

    const token = `${mid}:${this.currentOptions.minCommentLevel}:${this.currentOptions.hideMode}`
    element.setAttribute(COMMENT_EVAL_TOKEN_ATTR, token)

    let level = this.extractLevelSync(item)
    if (level === null) {
      level = await this.levelService.getLevel(mid)
      if (!this.active || !element.isConnected) {
        return
      }
      if (element.getAttribute(COMMENT_EVAL_TOKEN_ATTR) !== token) {
        return
      }
    }

    if (level === null) {
      this.clearItemState(element)
      return
    }

    if (level < this.currentOptions.minCommentLevel) {
      this.applyBlockedState(element, level, item.userName)
    } else {
      this.clearItemState(element)
    }
    this.updateBlockedCount()
  }

  private applyBlockedState(element: HTMLElement, level: number, userName: string) {
    const useCollapsed = this.currentOptions.hideMode === HideMode.Collapsed
    element.setAttribute(
      'data-be-blocked-label',
      `已屏蔽 Lv.${level} 用户 ${userName || ''} 的评论 · 点击临时查看`,
    )
    if (useCollapsed) {
      element.classList.remove(BLOCKED_CLASS)
      element.classList.add(COLLAPSED_CLASS)
    } else {
      element.classList.remove(COLLAPSED_CLASS, TEMP_SHOW_CLASS)
      element.classList.add(BLOCKED_CLASS)
    }
    element.classList.toggle(FORCE_SHOW_CLASS, this.forceShowAll)
  }

  private clearItemState(element: HTMLElement) {
    element.classList.remove(BLOCKED_CLASS, COLLAPSED_CLASS, TEMP_SHOW_CLASS, FORCE_SHOW_CLASS)
    element.removeAttribute('data-be-blocked-label')
  }

  private updateBlockedCount() {
    let count = 0
    this.trackedItems.forEach(item => {
      if (
        item.element?.isConnected &&
        (item.element.classList.contains(BLOCKED_CLASS) ||
          item.element.classList.contains(COLLAPSED_CLASS))
      ) {
        count += 1
      }
    })
    if (count !== this.blockedCount) {
      this.blockedCount = count
      this.onStatsChange?.()
    }
  }
}
