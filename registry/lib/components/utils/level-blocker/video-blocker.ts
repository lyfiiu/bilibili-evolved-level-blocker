import { forEachFeedsCard } from '@/components/feeds/api'
import { childListSubtree, urlChange, videoChange } from '@/core/observer'
import { select } from '@/core/spin-query'
import { getUID, getVue2Data, matchCurrentPage } from '@/core/utils'
import { videoAndBangumiUrls } from '@/core/utils/urls'
import { LevelService } from './level-service'
import { DynamicFilterScope, HideMode, LevelBlockerOptions, parseWhitelistUids } from './options'

export const VIDEO_BLOCKED_CLASS = 'be-level-video-blocked'
export const VIDEO_COLLAPSED_CLASS = 'be-level-video-collapsed'
export const VIDEO_TEMP_SHOW_CLASS = 'be-level-temp-show'
export const VIDEO_FORCE_SHOW_CLASS = 'be-level-force-show'
const VIDEO_PAGE_OVERLAY_ID = 'be-level-video-page-overlay'

const CARD_UNIT_SELECTOR = [
  '.bili-feed-card',
  '.feed-card',
  '.video-list-item',
  '.video-page-card-small',
  '.video-page-card',
  '.video-page-operator-card-small',
  '.recommend-video-card',
  '.remd-video-card',
  '[class*="RecommendItem_wrap"]',
  '[class*="recommend_item"]',
  '.bili-dyn-list__item',
  '.bili-dyn-item',
  '.small-item',
  '.upload-video-card',
  '.rank-item',
  'a.video-card',
  '.bili-video-card',
].join(', ')

const OUTER_WRAPPER_SELECTOR = [
  '.bili-feed-card',
  '.feed-card',
  '.video-list-item',
  '.bili-dyn-list__item',
  '.rank-item',
].join(', ')

interface ExtractedVideoMeta {
  mid?: string
  name?: string
  bvid?: string
  aid?: string
  isDynamicCard: boolean
  isVideoDynamic: boolean
}

export class VideoBlocker {
  private active = false
  private currentOptions: LevelBlockerOptions
  private whitelist = new Set<string>()
  private ownUid = ''
  private onStatsChange?: () => void
  private blockedCount = 0
  private forceShowAll = false

  private domObserver: MutationObserver | null = null
  private visibilityObserver: IntersectionObserver | null = null
  private visibleCards = new WeakSet<HTMLElement>()
  private knownCards = new Set<HTMLElement>()
  private scanScheduled = false
  private homePreloadTimer: number | null = null
  private feedsHooked = false
  private videoPageAbortController: AbortController | null = null
  private dismissedVideoKey = ''

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
    this.initVisibilityObserver()
    this.initDomObserver()
    this.initFeedsHook()
    this.initVideoPageCheck()
    this.scheduleScan()
  }

  stop() {
    this.active = false
    this.domObserver?.disconnect()
    this.domObserver = null
    this.visibilityObserver?.disconnect()
    this.visibilityObserver = null
    this.videoPageAbortController?.abort()
    this.videoPageAbortController = null
    if (this.homePreloadTimer !== null) {
      window.clearTimeout(this.homePreloadTimer)
      this.homePreloadTimer = null
    }
    this.knownCards.forEach(card => {
      this.clearCardState(card)
    })
    this.removeVideoPageOverlay()
    this.updateBlockedCount()
  }

  updateOptions(nextOptions: LevelBlockerOptions) {
    this.currentOptions = nextOptions
    this.whitelist = parseWhitelistUids(nextOptions.whitelistUids)
    this.dismissedVideoKey = ''
    this.reEvaluateAll()
    this.checkCurrentVideoPage()
  }

  getBlockedCount() {
    return this.blockedCount
  }

  setForceShowAll(showAll: boolean) {
    this.forceShowAll = showAll
    this.knownCards.forEach(card => {
      if (card.isConnected) {
        card.classList.toggle(
          VIDEO_FORCE_SHOW_CLASS,
          showAll &&
            (card.classList.contains(VIDEO_BLOCKED_CLASS) ||
              card.classList.contains(VIDEO_COLLAPSED_CLASS)),
        )
      }
    })
  }

  reEvaluateAll() {
    if (!this.active) {
      return
    }
    this.knownCards.forEach(card => {
      if (!card.isConnected) {
        this.knownCards.delete(card)
        return
      }
      this.evaluateCard(card, true)
    })
    this.scheduleScan()
    this.updateBlockedCount()
  }

  private initVisibilityObserver() {
    if (this.visibilityObserver) {
      return
    }
    this.visibilityObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          const el = entry.target as HTMLElement
          if (entry.isIntersecting) {
            this.visibleCards.add(el)
            if (this.active) {
              this.evaluateCard(el)
            }
          }
        })
      },
      { rootMargin: '450px 0px' },
    )
  }

  private initDomObserver() {
    if (this.domObserver || !document.body) {
      return
    }
    const [observer] = childListSubtree(document.body, () => {
      this.scheduleScan()
    })
    this.domObserver = observer
  }

  private initFeedsHook() {
    if (this.feedsHooked) {
      return
    }
    this.feedsHooked = true
    forEachFeedsCard({
      added: card => {
        if (!this.active) {
          return
        }
        const unit = this.normalizeCardUnit(card.element)
        if (unit) {
          this.registerCard(unit)
        }
      },
    })
  }

  private initVideoPageCheck() {
    if (!matchCurrentPage(videoAndBangumiUrls)) {
      return
    }
    this.videoPageAbortController = new AbortController()
    const { signal } = this.videoPageAbortController
    urlChange(() => {
      if (this.active) {
        this.checkCurrentVideoPage()
        this.scheduleScan()
      }
    }, { signal })
    videoChange(() => {
      if (this.active) {
        this.checkCurrentVideoPage()
        this.scheduleScan()
      }
    }, { signal })
  }

  private scheduleScan() {
    if (!this.active || this.scanScheduled) {
      return
    }
    this.scanScheduled = true
    requestAnimationFrame(() => {
      this.scanScheduled = false
      if (!this.active) {
        return
      }
      this.scanAllCards()
    })
  }

  private scanAllCards() {
    this.harvestSearchPiniaStore()
    const rawElements = document.querySelectorAll<HTMLElement>(CARD_UNIT_SELECTOR)
    const seenUnits = new Set<HTMLElement>()
    rawElements.forEach(el => {
      const unit = this.normalizeCardUnit(el)
      if (!unit || seenUnits.has(unit)) {
        return
      }
      seenUnits.add(unit)
      this.registerCard(unit)
    })
    this.updateBlockedCount()
  }

  private normalizeCardUnit(element: HTMLElement): HTMLElement | null {
    if (!element?.isConnected) {
      return null
    }
    // 排除顶栏/弹窗非内容区小元素，保留主站与 Bilibili-Evolved 视频卡片
    if (element.closest('.settings-panel, .bili-header .v-popover-content')) {
      return null
    }
    const outer = element.closest<HTMLElement>(OUTER_WRAPPER_SELECTOR)
    if (outer) {
      return outer
    }
    return element
  }

  private registerCard(card: HTMLElement) {
    if (!this.knownCards.has(card)) {
      this.knownCards.add(card)
      this.visibilityObserver?.observe(card)
      this.bindCollapseToggle(card)
    }
    this.evaluateCard(card)
  }

  private bindCollapseToggle(card: HTMLElement) {
    if (card.dataset.beLevelVideoToggleBound === '1') {
      return
    }
    card.dataset.beLevelVideoToggleBound = '1'
    card.addEventListener(
      'click',
      event => {
        if (!card.classList.contains(VIDEO_COLLAPSED_CLASS)) {
          return
        }
        if (!card.classList.contains(VIDEO_TEMP_SHOW_CLASS)) {
          event.preventDefault()
          event.stopImmediatePropagation()
          card.classList.add(VIDEO_TEMP_SHOW_CLASS)
        }
      },
      true,
    )
  }

  /** 从搜索页 Pinia store 提取 bvid -> mid（搜索结果翻页后同步补充） */
  private harvestSearchPiniaStore() {
    if (location.hostname !== 'search.bilibili.com') {
      return
    }
    document.querySelectorAll('#app, #i_cecream').forEach(root => {
      // eslint-disable-next-line no-underscore-dangle
      const state = (root as any).__vue_app__?.config?.globalProperties?.$pinia?.state?.value
      if (state?.searchResponse) {
        this.levelService.harvestFromPayload(state.searchResponse)
      }
      if (state?.searchTypeResponse) {
        this.levelService.harvestFromPayload(state.searchTypeResponse)
      }
    })
  }

  /** 从卡片 DOM / Vue2 / Vue3 实例 / Pinia 缓存中提取 UP 主 mid 与 bvid */
  private extractCardMeta(card: HTMLElement): ExtractedVideoMeta {
    const isDynamicCard = Boolean(
      card.matches('.bili-dyn-list__item, .bili-dyn-item') || card.querySelector('.bili-dyn-item'),
    )
    const meta: ExtractedVideoMeta = {
      isDynamicCard,
      isVideoDynamic: false,
    }

    // 1. 提取视频 bvid / aid（过滤番剧/课程/直播等非普通 UP 主投稿）
    const links = card.querySelectorAll<HTMLAnchorElement>('a[href]')
    for (const link of links) {
      const href = link.getAttribute('href') || ''
      if (href.includes('/bangumi/play/') || href.includes('/cheese/')) {
        return meta
      }
      const bvMatch = href.match(/\/video\/(BV[0-9A-Za-z]+)/)
      if (bvMatch && !meta.bvid) {
        meta.bvid = bvMatch[1]
        meta.isVideoDynamic = true
      }
      const avMatch = href.match(/\/video\/av(\d+)/i)
      if (avMatch && !meta.aid) {
        meta.aid = avMatch[1]
        meta.isVideoDynamic = true
      }
      const spaceMatch = href.match(/space\.bilibili\.com\/(\d+)/)
      if (spaceMatch && !meta.mid) {
        meta.mid = spaceMatch[1]
        if (!meta.name) {
          meta.name = link.textContent?.trim() || undefined
        }
      }
    }

    // 2. 从 data-usercard-mid / data-mid 读取
    if (!meta.mid) {
      const midHolder = card.matches('[data-usercard-mid], [data-mid]')
        ? card
        : card.querySelector<HTMLElement>('[data-usercard-mid], [data-mid]')
      const attrMid =
        midHolder?.getAttribute('data-usercard-mid') ?? midHolder?.getAttribute('data-mid')
      if (attrMid && /^\d+$/.test(attrMid)) {
        meta.mid = attrMid
      }
    }

    // 3. 从 Vue 2 / Vue 3 组件实例数据提取
    this.extractFromVueInstance(card, meta)

    // 4. 从被动拦截到的 bvid/aid -> mid 缓存补全
    if (!meta.mid && (meta.bvid || meta.aid)) {
      const cachedMid = this.levelService.getCachedOwnerMid({
        bvid: meta.bvid,
        aid: meta.aid,
      })
      if (cachedMid) {
        meta.mid = cachedMid
      }
    }

    if (!meta.name) {
      const authorEl = card.querySelector(
        '.bili-video-card__info--author, .up-name, .up .name, .bili-dyn-title__text, .name',
      )
      meta.name = authorEl?.textContent?.trim() || undefined
    }

    return meta
  }

  private extractFromVueInstance(card: HTMLElement, meta: ExtractedVideoMeta) {
    const candidates: Element[] = [card]
    const innerDyn = card.querySelector('.bili-dyn-item, .bili-video-card')
    if (innerDyn) {
      candidates.push(innerDyn)
    }

    for (const el of candidates) {
      // Vue 2 (__vue__)
      try {
        const vue2 = getVue2Data(el) as Record<string, any> | undefined
        if (vue2) {
          this.readObjectIntoMeta(vue2.data ?? vue2.item ?? vue2.videoData ?? vue2, meta)
        }
      } catch {
        // getVue2Data 访问 children 时可能为空
      }
      // Vue 3 (__vueParentComponent)
      // eslint-disable-next-line no-underscore-dangle
      const v3 = (el as any).__vueParentComponent
      if (v3?.props) {
        this.readObjectIntoMeta(v3.props, meta)
      }
      if (v3?.ctx) {
        this.readObjectIntoMeta(v3.ctx, meta)
      }
      if (meta.mid) {
        break
      }
    }
  }

  private readObjectIntoMeta(source: unknown, meta: ExtractedVideoMeta) {
    if (!source || typeof source !== 'object') {
      return
    }
    const obj = source as Record<string, any>
    // 动态卡片结构 (modules)
    if (Array.isArray(obj.modules)) {
      for (const mod of obj.modules) {
        if (mod?.module_author?.mid) {
          if (!meta.mid) {
            meta.mid = String(mod.module_author.mid)
          }
          if (!meta.name && mod.module_author.name) {
            meta.name = String(mod.module_author.name)
          }
          if (mod.module_author.following) {
            this.levelService.recordFollowing(mod.module_author.mid, true)
          }
        }
        const archive = mod?.module_dynamic?.major?.archive
        if (archive) {
          meta.isVideoDynamic = true
          if (!meta.bvid && archive.bvid) {
            meta.bvid = String(archive.bvid)
          }
        }
      }
    }
    if (obj.type === 'DYNAMIC_TYPE_AV') {
      meta.isVideoDynamic = true
    }
    // 普通视频卡片结构
    const item = (obj.item ?? obj.video ?? obj.info ?? obj) as Record<string, any>
    const owner = item?.owner as Record<string, any> | undefined
    if (owner?.mid && !meta.mid) {
      meta.mid = String(owner.mid)
      if (!meta.name && owner.name) {
        meta.name = String(owner.name)
      }
    }
    if (item?.mid && /^\d+$/.test(String(item.mid)) && !meta.mid) {
      meta.mid = String(item.mid)
    }
    if (item?.upID && /^\d+$/.test(String(item.upID)) && !meta.mid) {
      meta.mid = String(item.upID)
    }
    if (item?.bvid && !meta.bvid) {
      meta.bvid = String(item.bvid)
    }
    if (meta.bvid && meta.mid) {
      this.levelService.recordVideoOwner({ bvid: meta.bvid, aid: meta.aid }, meta.mid)
    }
  }

  private async evaluateCard(card: HTMLElement, force = false) {
    if (!card.isConnected) {
      return
    }
    if (
      !this.active ||
      !this.currentOptions.blockVideos ||
      this.currentOptions.minUploaderLevel <= 0
    ) {
      this.clearCardState(card)
      return
    }

    const meta = this.extractCardMeta(card)
    if (
      meta.isDynamicCard &&
      this.currentOptions.dynamicFilterScope === DynamicFilterScope.VideoOnly &&
      !meta.isVideoDynamic
    ) {
      this.clearCardState(card)
      return
    }

    // 尝试通过 bvid 反查尚未暴露 mid 的可视卡片（例如首页推荐卡片仅展示 UP 名而无空间链接）
    let { mid } = meta
    if (!mid && meta.bvid && this.visibleCards.has(card)) {
      mid = (await this.levelService.resolveMidByBvid(meta.bvid)) ?? undefined
      if (!this.active || !card.isConnected) {
        return
      }
    }

    if (!mid) {
      this.clearCardState(card)
      return
    }

    const evalKey = `${mid}:${this.currentOptions.minUploaderLevel}:${this.currentOptions.hideMode}:${this.currentOptions.whitelistFollowing}:${this.currentOptions.whitelistUids}`
    if (!force && card.dataset.beLevelEvalKey === evalKey) {
      return
    }
    card.dataset.beLevelEvalKey = evalKey

    if ((this.ownUid && mid === this.ownUid) || this.whitelist.has(mid)) {
      this.clearCardState(card)
      return
    }
    if (this.currentOptions.whitelistFollowing && this.levelService.isFollowing(mid)) {
      this.clearCardState(card)
      return
    }

    let level = this.levelService.getCachedLevel(mid)
    if (level === null) {
      // 尚未进入视口附近且无缓存时，先等待滚动进入预加载范围再查询，避免一次性请求过多卡片
      if (!this.visibleCards.has(card)) {
        delete card.dataset.beLevelEvalKey
        return
      }
      level = await this.levelService.getLevel(mid)
      if (!this.active || !card.isConnected || card.dataset.beLevelEvalKey !== evalKey) {
        return
      }
    }

    if (level === null) {
      this.clearCardState(card)
      return
    }

    if (level < this.currentOptions.minUploaderLevel) {
      this.applyBlockedState(card, level, meta.name)
    } else {
      this.clearCardState(card)
    }
    this.updateBlockedCount()
  }

  private applyBlockedState(card: HTMLElement, level: number, upName?: string) {
    const useCollapsed = this.currentOptions.hideMode === HideMode.Collapsed
    card.setAttribute(
      'data-be-video-blocked-label',
      `已屏蔽 Lv.${level} UP主 ${upName || ''} 的内容 · 点击临时查看`,
    )
    if (useCollapsed) {
      card.classList.remove(VIDEO_BLOCKED_CLASS)
      card.classList.add(VIDEO_COLLAPSED_CLASS)
    } else {
      card.classList.remove(VIDEO_COLLAPSED_CLASS, VIDEO_TEMP_SHOW_CLASS)
      card.classList.add(VIDEO_BLOCKED_CLASS)
      this.ensureHomeFeedNotEmpty()
    }
    card.classList.toggle(VIDEO_FORCE_SHOW_CLASS, this.forceShowAll)
  }

  private clearCardState(card: HTMLElement) {
    card.classList.remove(
      VIDEO_BLOCKED_CLASS,
      VIDEO_COLLAPSED_CLASS,
      VIDEO_TEMP_SHOW_CLASS,
      VIDEO_FORCE_SHOW_CLASS,
    )
    card.removeAttribute('data-be-video-blocked-label')
    delete card.dataset.beLevelEvalKey
  }

  /** 首页大量卡片被隐藏时温和触发一次滚动检查，促使 B 站自动补全后续推荐流 */
  private ensureHomeFeedNotEmpty() {
    if (document.URL.replace(window.location.search, '') !== 'https://www.bilibili.com/') {
      return
    }
    if (this.homePreloadTimer !== null) {
      return
    }
    this.homePreloadTimer = window.setTimeout(() => {
      this.homePreloadTimer = null
      if (!this.active) {
        return
      }
      const container = document.querySelector('main .feed2 .container, .recommended-container_floor-aside > .container')
      if (!container) {
        return
      }
      const visibleCards = Array.from(container.children).filter(
        el =>
          el instanceof HTMLElement &&
          !el.classList.contains(VIDEO_BLOCKED_CLASS) &&
          !el.classList.contains('load-more-anchor') &&
          getComputedStyle(el).display !== 'none',
      )
      if (visibleCards.length < 6) {
        window.dispatchEvent(new Event('scroll'))
      }
    }, 300)
  }

  private async checkCurrentVideoPage() {
    this.removeVideoPageOverlay()
    if (
      !this.active ||
      !this.currentOptions.blockVideos ||
      !this.currentOptions.blockVideoPage ||
      this.currentOptions.minUploaderLevel <= 0 ||
      !matchCurrentPage(videoAndBangumiUrls)
    ) {
      return
    }

    const ownerInfo = await select(() => {
      // eslint-disable-next-line no-underscore-dangle
      const state = (unsafeWindow as any).__INITIAL_STATE__
      const owner = state?.videoData?.owner
      if (owner?.mid) {
        return { mid: String(owner.mid), name: String(owner.name || '') }
      }
      const upLink = document.querySelector<HTMLAnchorElement>(
        '.up-info-container a.up-name[href*="space.bilibili.com/"]',
      )
      const match = upLink?.getAttribute('href')?.match(/space\.bilibili\.com\/(\d+)/)
      if (match) {
        return { mid: match[1], name: upLink?.textContent?.trim() || '' }
      }
      return null
    })

    if (!ownerInfo || !this.active) {
      return
    }
    if ((this.ownUid && ownerInfo.mid === this.ownUid) || this.whitelist.has(ownerInfo.mid)) {
      return
    }
    if (this.currentOptions.whitelistFollowing && this.levelService.isFollowing(ownerInfo.mid)) {
      return
    }
    const videoKey = `${location.pathname}:${ownerInfo.mid}`
    if (this.dismissedVideoKey === videoKey) {
      return
    }

    const level = await this.levelService.getLevel(ownerInfo.mid)
    if (!this.active || level === null || level >= this.currentOptions.minUploaderLevel) {
      return
    }

    const videoEl = document.querySelector<HTMLVideoElement>('video, bwp-video')
    if (videoEl && !videoEl.paused) {
      videoEl.pause()
    }
    this.showVideoPageOverlay(ownerInfo.name, level, videoKey)
  }

  private showVideoPageOverlay(upName: string, level: number, videoKey: string) {
    this.removeVideoPageOverlay()
    const playerArea =
      document.querySelector('#bilibili-player, .bpx-player-container') ?? document.body
    const overlay = document.createElement('div')
    overlay.id = VIDEO_PAGE_OVERLAY_ID
    overlay.innerHTML = `
      <div class="be-level-overlay-card">
        <div class="be-level-overlay-title">已拦截低等级 UP 主视频</div>
        <div class="be-level-overlay-desc">
          当前 UP 主 <strong>${lodash.escape(upName || '未知')}</strong> 等级为 <strong>Lv.${level}</strong>，低于设定阈值 Lv.${this.currentOptions.minUploaderLevel}。
        </div>
        <div class="be-level-overlay-actions">
          <button type="button" class="be-level-overlay-btn primary" data-action="continue">仍然观看</button>
        </div>
      </div>
    `
    overlay.querySelector('[data-action="continue"]')?.addEventListener('click', () => {
      this.dismissedVideoKey = videoKey
      this.removeVideoPageOverlay()
    })
    playerArea.appendChild(overlay)
  }

  private removeVideoPageOverlay() {
    document.getElementById(VIDEO_PAGE_OVERLAY_ID)?.remove()
  }

  private updateBlockedCount() {
    let count = 0
    this.knownCards.forEach(card => {
      if (
        card.isConnected &&
        (card.classList.contains(VIDEO_BLOCKED_CLASS) ||
          card.classList.contains(VIDEO_COLLAPSED_CLASS))
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
