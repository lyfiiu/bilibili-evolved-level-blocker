import { SHOW_ALL_CLASS } from './comment-blocker'

const BADGE_ID = 'be-level-blocker-stats-badge'

export class StatsBadge {
  private visible = true
  private showAll = false
  private videoCount = 0
  private commentCount = 0
  private badgeEl: HTMLElement | null = null
  private onToggleCallback?: (showAll: boolean) => void

  constructor(onToggle?: (showAll: boolean) => void) {
    this.onToggleCallback = onToggle
  }

  setVisible(visible: boolean) {
    this.visible = visible
    this.render()
  }

  updateCounts(videoCount: number, commentCount: number) {
    this.videoCount = videoCount
    this.commentCount = commentCount
    this.render()
  }

  destroy() {
    this.showAll = false
    document.documentElement.classList.remove(SHOW_ALL_CLASS)
    this.badgeEl?.remove()
    this.badgeEl = null
  }

  private render() {
    const total = this.videoCount + this.commentCount
    if (!this.visible || total === 0 || !document.body) {
      if (this.badgeEl) {
        this.badgeEl.style.display = 'none'
      }
      return
    }
    if (!this.badgeEl || !this.badgeEl.isConnected) {
      this.badgeEl = document.getElementById(BADGE_ID) ?? this.createBadge()
    }
    this.badgeEl.style.display = ''
    const parts: string[] = []
    if (this.videoCount > 0) {
      parts.push(`${this.videoCount} 视频`)
    }
    if (this.commentCount > 0) {
      parts.push(`${this.commentCount} 评论`)
    }
    const label = this.showAll
      ? `已临时显示 (${parts.join(' / ')}) · 恢复屏蔽`
      : `已屏蔽 ${parts.join(' / ')} · 临时显示`
    if (this.badgeEl.textContent !== label) {
      this.badgeEl.textContent = label
    }
    this.badgeEl.classList.toggle('is-showing-all', this.showAll)
  }

  private createBadge(): HTMLElement {
    const el = document.createElement('button')
    el.type = 'button'
    el.id = BADGE_ID
    el.title = '点击切换临时显示或恢复等级屏蔽'
    el.addEventListener('click', () => {
      this.showAll = !this.showAll
      document.documentElement.classList.toggle(SHOW_ALL_CLASS, this.showAll)
      this.render()
      this.onToggleCallback?.(this.showAll)
    })
    document.body.appendChild(el)
    return el
  }
}
