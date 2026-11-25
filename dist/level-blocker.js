(() => {
  'use strict'

  const { defineComponentMetadata, defineOptionsMetadata } = coreApis.componentApis.define
  const { forEachCommentItem } = coreApis.componentApis.utils.commentApis
  const { forEachFeedsCard } = coreApis.componentApis.feeds.api
  const { getJsonWithCredentials } = coreApis.ajax
  const { childListSubtree, urlChange, videoChange } = coreApis.observer
  const { select } = coreApis.spinQuery
  const { addComponentListener, removeComponentListener, getComponentSettings } = coreApis.settings
  const { delay, getNumberValidator, getUID, getVue2Data, matchCurrentPage } = coreApis.utils
  const { useScopedConsole } = coreApis.utils.log
  const { videoAndBangumiUrls } = coreApis.utils.urls

  const componentName = 'levelBlocker'
  const displayName = '等级屏蔽器'
  const logger = useScopedConsole(displayName)

  const HideMode = {
    Hidden: '完全隐藏',
    Collapsed: '折叠占位提示',
  }

  const DynamicFilterScope = {
    All: '全部动态',
    VideoOnly: '仅视频动态',
  }

  const options = defineOptionsMetadata({
    blockVideos: {
      displayName: '屏蔽低等级 UP 主视频',
      defaultValue: true,
    },
    minUploaderLevel: {
      displayName: '最低 UP 主等级',
      defaultValue: 3,
      slider: { min: 0, max: 6, step: 1 },
      validator: getNumberValidator(0, 6),
    },
    blockComments: {
      displayName: '屏蔽低等级评论区评论',
      defaultValue: true,
    },
    minCommentLevel: {
      displayName: '最低评论用户等级',
      defaultValue: 2,
      slider: { min: 0, max: 6, step: 1 },
      validator: getNumberValidator(0, 6),
    },
    hideMode: {
      displayName: '屏蔽方式',
      dropdownEnum: HideMode,
      defaultValue: HideMode.Hidden,
    },
    dynamicFilterScope: {
      displayName: '动态页屏蔽范围',
      dropdownEnum: DynamicFilterScope,
      defaultValue: DynamicFilterScope.All,
    },
    blockVideoPage: {
      displayName: '拦截播放页低等级 UP 主视频',
      defaultValue: false,
    },
    whitelistFollowing: {
      displayName: '放行已关注账号',
      defaultValue: true,
    },
    whitelistUids: {
      displayName: 'UID 白名单（逗号或换行分隔）',
      defaultValue: '',
      multiline: true,
    },
    showFilteredCount: {
      displayName: '显示本页已屏蔽统计',
      defaultValue: true,
    },
    cacheDays: {
      displayName: '等级缓存天数',
      defaultValue: 7,
      slider: { min: 1, max: 30, step: 1 },
      validator: getNumberValidator(1, 30),
    },
  })

  const parseWhitelistUids = raw => {
    const result = new Set()
    if (!raw) {
      return result
    }
    raw.split(/[\s,，;；]+/).forEach(token => {
      const trimmed = token.trim()
      if (/^\d+$/.test(trimmed)) {
        result.add(trimmed)
      }
    })
    return result
  }

  const DOM_STYLE = `
.be-level-blocked:not(.be-level-force-show),
.be-level-video-blocked:not(.be-level-force-show) {
  display: none !important;
}
.be-level-blocked-collapsed:not(.be-level-temp-show):not(.be-level-force-show),
.be-level-video-collapsed:not(.be-level-temp-show):not(.be-level-force-show) {
  display: block !important;
  min-height: 0 !important;
  height: auto !important;
  padding: 0 !important;
}
.be-level-blocked-collapsed:not(.be-level-temp-show):not(.be-level-force-show) > *,
.be-level-video-collapsed:not(.be-level-temp-show):not(.be-level-force-show) > * {
  display: none !important;
}
.be-level-blocked-collapsed:not(.be-level-temp-show):not(.be-level-force-show)::before,
.be-level-video-collapsed:not(.be-level-temp-show):not(.be-level-force-show)::before {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  margin: 4px 0;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  user-select: none;
  color: var(--be-color-text-secondary, #666);
  background-color: var(--be-color-card-bg, rgba(136, 136, 136, 0.1));
  border: 1px dashed var(--be-color-border, rgba(136, 136, 136, 0.25));
  transition: background-color 0.2s ease;
}
.be-level-video-collapsed:not(.be-level-temp-show):not(.be-level-force-show)::before {
  content: attr(data-be-video-blocked-label);
}
.be-level-blocked-collapsed:not(.be-level-temp-show):not(.be-level-force-show)::before {
  content: attr(data-be-blocked-label);
}
.be-level-blocked-collapsed:not(.be-level-temp-show):not(.be-level-force-show):hover::before,
.be-level-video-collapsed:not(.be-level-temp-show):not(.be-level-force-show):hover::before {
  background-color: rgba(136, 136, 136, 0.18);
}
#be-level-blocker-stats-badge {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 9999;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  border: 1px solid rgba(136, 136, 136, 0.28);
  background-color: var(--be-color-panel-bg, rgba(255, 255, 255, 0.92));
  color: var(--be-color-text-title, #333);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(8px);
  transition: transform 0.15s ease, border-color 0.15s ease;
}
#be-level-blocker-stats-badge:hover {
  transform: translateY(-1px);
  border-color: var(--theme-color, #00a1d6);
}
#be-level-blocker-stats-badge.is-showing-all {
  border-color: var(--theme-color, #00a1d6);
  color: var(--theme-color, #00a1d6);
}
body.dark #be-level-blocker-stats-badge {
  background-color: var(--be-color-panel-bg, rgba(34, 34, 34, 0.92));
  color: var(--be-color-text-title, #eee);
}
#be-level-video-page-overlay {
  position: absolute;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 15, 18, 0.88);
  backdrop-filter: blur(6px);
  color: #fff;
  padding: 20px;
}
#be-level-video-page-overlay .be-level-overlay-card {
  max-width: 380px;
  width: 100%;
  padding: 20px 24px;
  border-radius: 10px;
  background: var(--be-color-panel-bg, #222);
  color: var(--be-color-text-title, #f2f2f2);
  border: 1px solid rgba(255, 255, 255, 0.12);
  text-align: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
#be-level-video-page-overlay .be-level-overlay-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 10px;
}
#be-level-video-page-overlay .be-level-overlay-desc {
  font-size: 13px;
  line-height: 1.6;
  opacity: 0.9;
  margin-bottom: 16px;
}
#be-level-video-page-overlay .be-level-overlay-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}
#be-level-video-page-overlay .be-level-overlay-btn {
  padding: 6px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  background: var(--theme-color, #00a1d6);
  color: #fff;
}
#be-level-video-page-overlay .be-level-overlay-btn:hover {
  opacity: 0.9;
}
`

  const SHADOW_STYLE = `
bili-comment-thread-renderer.be-level-blocked:not(.be-level-force-show),
bili-comment-reply-renderer.be-level-blocked:not(.be-level-force-show),
:host(.be-level-blocked:not(.be-level-force-show)) {
  display: none !important;
}
:host(.be-level-blocked-collapsed:not(.be-level-temp-show):not(.be-level-force-show)) {
  display: block !important;
}
:host(.be-level-blocked-collapsed:not(.be-level-temp-show):not(.be-level-force-show)) > * {
  display: none !important;
}
:host(.be-level-blocked-collapsed:not(.be-level-temp-show):not(.be-level-force-show))::before {
  content: attr(data-be-blocked-label);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  margin: 6px 0;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  user-select: none;
  color: var(--text3, #888);
  background-color: rgba(136, 136, 136, 0.1);
  border: 1px dashed rgba(136, 136, 136, 0.25);
}
:host(.be-level-blocked-collapsed:not(.be-level-temp-show):not(.be-level-force-show)):hover::before {
  background-color: rgba(136, 136, 136, 0.18);
}
`

  const CACHE_STORAGE_KEY = 'be_level_blocker_cache_v1'
  const MAX_CACHE_ENTRIES = 5000
  const PRUNE_TARGET_ENTRIES = 3600
  const BATCH_MAX_SIZE = 40
  const BATCH_DEBOUNCE_MS = 60
  const SINGLE_CONCURRENCY = 2
  const SINGLE_SPACING_MS = 120
  const VIEW_CONCURRENCY = 1
  const VIEW_SPACING_MS = 280
  const RATE_LIMIT_COOLDOWN_MS = 20000

  class LevelService {
    constructor() {
      this.memoryCache = new Map()
      this.followingSet = new Set()
      this.bvidToMid = new Map()
      this.aidToMid = new Map()
      this.inFlightLevel = new Map()
      this.inFlightMidByBvid = new Map()
      this.batchPending = new Map()
      this.batchTimer = null
      this.batchDisabled = false
      this.singleQueue = []
      this.singleActive = 0
      this.viewQueue = []
      this.viewActive = 0
      this.cooldownUntil = 0
      this.cacheDays = 7
      this.cacheLoaded = false
      this.persistTimer = null
      this.networkHooked = false
      this.onPassiveDataCallback = null
    }

    setCacheDays(days) {
      this.cacheDays = Math.min(Math.max(Number(days) || 7, 1), 30)
    }

    onPassiveData(callback) {
      this.onPassiveDataCallback = callback
    }

    ensureCacheLoaded() {
      if (this.cacheLoaded) {
        return
      }
      this.cacheLoaded = true
      try {
        const raw = localStorage.getItem(CACHE_STORAGE_KEY)
        if (!raw) {
          return
        }
        const parsed = JSON.parse(raw)
        const now = Date.now()
        Object.entries(parsed).forEach(([mid, entry]) => {
          if (
            Array.isArray(entry) &&
            entry.length === 2 &&
            typeof entry[0] === 'number' &&
            entry[0] >= 0 &&
            entry[0] <= 6 &&
            typeof entry[1] === 'number' &&
            entry[1] > now
          ) {
            this.memoryCache.set(mid, entry)
          }
        })
      } catch {
        // 忽略损坏缓存
      }
    }

    schedulePersist() {
      if (this.persistTimer !== null) {
        return
      }
      this.persistTimer = window.setTimeout(() => {
        this.persistTimer = null
        this.persistNow()
      }, 1500)
    }

    persistNow() {
      this.ensureCacheLoaded()
      const now = Date.now()
      for (const [mid, [, expiresAt]] of this.memoryCache.entries()) {
        if (expiresAt <= now) {
          this.memoryCache.delete(mid)
        }
      }
      if (this.memoryCache.size > MAX_CACHE_ENTRIES) {
        const excess = this.memoryCache.size - PRUNE_TARGET_ENTRIES
        let removed = 0
        for (const key of this.memoryCache.keys()) {
          this.memoryCache.delete(key)
          removed += 1
          if (removed >= excess) {
            break
          }
        }
      }
      try {
        localStorage.setItem(
          CACHE_STORAGE_KEY,
          JSON.stringify(Object.fromEntries(this.memoryCache.entries())),
        )
      } catch {
        this.memoryCache.clear()
      }
    }

    computeTtlMs(level) {
      const dayMs = 86400 * 1000
      if (level === 6) {
        return Math.max(this.cacheDays, 30) * dayMs
      }
      if (level >= 4) {
        return this.cacheDays * dayMs
      }
      return Math.min(this.cacheDays, 1) * dayMs
    }

    getCachedLevel(mid) {
      if (!mid) {
        return null
      }
      const key = String(mid)
      if (!/^\d+$/.test(key)) {
        return null
      }
      this.ensureCacheLoaded()
      const entry = this.memoryCache.get(key)
      if (!entry) {
        return null
      }
      if (entry[1] <= Date.now()) {
        this.memoryCache.delete(key)
        return null
      }
      return entry[0]
    }

    recordLevel(mid, level) {
      if (mid === null || mid === undefined) {
        return
      }
      const key = String(mid)
      if (!/^\d+$/.test(key)) {
        return
      }
      const numLevel = Number(level)
      if (!Number.isInteger(numLevel) || numLevel < 0 || numLevel > 6) {
        return
      }
      this.ensureCacheLoaded()
      const existing = this.memoryCache.get(key)
      const expiresAt = Date.now() + this.computeTtlMs(numLevel)
      this.memoryCache.delete(key)
      this.memoryCache.set(key, [numLevel, expiresAt])
      if (!existing || existing[0] !== numLevel) {
        this.schedulePersist()
      }
    }

    recordFollowing(mid, following) {
      if (!mid || !following) {
        return
      }
      const key = String(mid)
      if (/^\d+$/.test(key)) {
        this.followingSet.add(key)
      }
    }

    isFollowing(mid) {
      if (!mid) {
        return false
      }
      return this.followingSet.has(String(mid))
    }

    recordVideoOwner(videoId, mid) {
      if (!mid) {
        return
      }
      const midStr = String(mid)
      if (!/^\d+$/.test(midStr)) {
        return
      }
      if (videoId.bvid) {
        this.bvidToMid.set(videoId.bvid, midStr)
      }
      if (videoId.aid) {
        this.aidToMid.set(String(videoId.aid), midStr)
      }
    }

    getCachedOwnerMid(videoId) {
      if (videoId.bvid && this.bvidToMid.has(videoId.bvid)) {
        return this.bvidToMid.get(videoId.bvid) ?? null
      }
      if (videoId.aid && this.aidToMid.has(String(videoId.aid))) {
        return this.aidToMid.get(String(videoId.aid)) ?? null
      }
      return null
    }

    installPassiveNetworkHook() {
      if (this.networkHooked) {
        return
      }
      this.networkHooked = true
      if (unsafeWindow.fetch && !unsafeWindow.__beLevelBlockerFetchHooked) {
        unsafeWindow.__beLevelBlockerFetchHooked = true
        const originalFetch = unsafeWindow.fetch
        unsafeWindow.fetch = new Proxy(originalFetch, {
          apply: (target, thisArg, args) => {
            const reqUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? ''
            const promise = target.apply(thisArg, args)
            if (this.shouldInspectApiUrl(reqUrl)) {
              promise
                .then(response => {
                  if (!response || !response.ok) {
                    return
                  }
                  response
                    .clone()
                    .json()
                    .then(json => {
                      if (json && json.code === 0) {
                        this.harvestFromPayload(json.data ?? json)
                      }
                    })
                    .catch(() => undefined)
                })
                .catch(() => undefined)
            }
            return promise
          },
        })
      }
    }

    shouldInspectApiUrl(rawUrl) {
      if (!rawUrl) {
        return false
      }
      try {
        const parsed = new URL(rawUrl, location.origin)
        if (!parsed.hostname.endsWith('bilibili.com')) {
          return false
        }
        return (
          parsed.pathname.includes('/x/web-interface/') ||
          parsed.pathname.includes('/x/polymer/web-dynamic/') ||
          parsed.pathname.includes('/x/v2/reply') ||
          parsed.pathname.includes('/x/space/') ||
          parsed.pathname.includes('/account/v1/user/')
        )
      } catch {
        return false
      }
    }

    harvestFromPayload(root) {
      let foundNew = false
      const visited = new Set()

      const walk = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 9 || visited.has(node)) {
          return
        }
        visited.add(node)
        if (Array.isArray(node)) {
          for (let i = 0; i < node.length; i += 1) {
            walk(node[i], depth + 1)
          }
          return
        }
        const mid = node.mid ?? node.uid
        if (mid && node.level_info && node.level_info.current_level !== undefined) {
          const before = this.getCachedLevel(mid)
          this.recordLevel(mid, node.level_info.current_level)
          if (before === null) {
            foundNew = true
          }
        }
        if (mid && typeof node.following === 'boolean' && node.following) {
          this.recordFollowing(mid, true)
        }
        if (node.owner && typeof node.owner === 'object' && node.owner.mid && (node.bvid || node.aid || node.id)) {
          this.recordVideoOwner(
            {
              bvid: typeof node.bvid === 'string' ? node.bvid : undefined,
              aid: node.aid ?? node.id,
            },
            node.owner.mid,
          )
          foundNew = true
        }
        if (typeof node.bvid === 'string' && node.mid) {
          this.recordVideoOwner({ bvid: node.bvid, aid: node.aid }, node.mid)
          foundNew = true
        }
        const values = Object.values(node)
        for (let i = 0; i < values.length; i += 1) {
          walk(values[i], depth + 1)
        }
      }

      walk(root, 0)
      if (foundNew && this.onPassiveDataCallback) {
        this.onPassiveDataCallback()
      }
    }

    getLevel(mid) {
      const key = String(mid)
      if (!/^\d+$/.test(key)) {
        return Promise.resolve(null)
      }
      const cached = this.getCachedLevel(key)
      if (cached !== null) {
        return Promise.resolve(cached)
      }
      const existing = this.inFlightLevel.get(key)
      if (existing) {
        return existing
      }
      const promise = new Promise(resolve => {
        if (this.batchDisabled) {
          this.enqueueSingle(key).then(resolve)
          return
        }
        const listeners = this.batchPending.get(key) ?? []
        listeners.push({ resolve })
        this.batchPending.set(key, listeners)
        this.scheduleBatchFlush()
      }).finally(() => {
        this.inFlightLevel.delete(key)
      })
      this.inFlightLevel.set(key, promise)
      return promise
    }

    resolveMidByBvid(bvid) {
      const cached = this.bvidToMid.get(bvid)
      if (cached) {
        return Promise.resolve(cached)
      }
      const inFlight = this.inFlightMidByBvid.get(bvid)
      if (inFlight) {
        return inFlight
      }
      const promise = this.runInQueue(
        this.viewQueue,
        () => this.viewActive,
        delta => {
          this.viewActive += delta
        },
        VIEW_CONCURRENCY,
        VIEW_SPACING_MS,
        async () => {
          if (Date.now() < this.cooldownUntil) {
            return null
          }
          try {
            const json = await getJsonWithCredentials(
              `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
            )
            if (json?.code === -412 || json?.code === -799) {
              this.triggerCooldown()
              return null
            }
            if (json?.code === 0 && json.data?.owner?.mid) {
              const ownerMid = String(json.data.owner.mid)
              this.recordVideoOwner({ bvid, aid: json.data.aid }, ownerMid)
              return ownerMid
            }
          } catch {
            // 不缓存失败结果
          }
          return null
        },
      ).finally(() => {
        this.inFlightMidByBvid.delete(bvid)
      })
      this.inFlightMidByBvid.set(bvid, promise)
      return promise
    }

    triggerCooldown() {
      this.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS
      logger.warn('触发风控限流保护，暂停等级查询 20 秒')
    }

    scheduleBatchFlush() {
      if (this.batchTimer !== null) {
        return
      }
      this.batchTimer = window.setTimeout(() => {
        this.batchTimer = null
        this.flushBatch()
      }, BATCH_DEBOUNCE_MS)
    }

    async flushBatch() {
      if (this.batchPending.size === 0) {
        return
      }
      const entries = Array.from(this.batchPending.entries())
      this.batchPending.clear()

      for (let i = 0; i < entries.length; i += BATCH_MAX_SIZE) {
        const chunk = entries.slice(i, i + BATCH_MAX_SIZE)
        if (Date.now() < this.cooldownUntil || this.batchDisabled) {
          chunk.forEach(([mid, listeners]) => {
            this.enqueueSingle(mid).then(level => listeners.forEach(l => l.resolve(level)))
          })
          continue
        }
        const uids = chunk.map(([mid]) => mid).join(',')
        const batchResolved = new Set()
        try {
          const json = await getJsonWithCredentials(
            `https://api.vc.bilibili.com/account/v1/user/cards?uids=${uids}`,
          )
          if (json?.code === -412 || json?.code === -799) {
            this.triggerCooldown()
          } else if (json?.code === -101) {
            this.batchDisabled = true
          } else if (json?.code === 0 && Array.isArray(json.data)) {
            json.data.forEach(item => {
              const itemMid = item?.mid ?? item?.card?.mid
              const levelInfo = item?.level_info ?? item?.card?.level_info
              if (itemMid && levelInfo?.current_level !== undefined) {
                const midStr = String(itemMid)
                const level = Number(levelInfo.current_level)
                if (Number.isInteger(level) && level >= 0 && level <= 6) {
                  this.recordLevel(midStr, level)
                  batchResolved.add(midStr)
                  const matched = chunk.find(([m]) => m === midStr)
                  matched?.[1].forEach(l => l.resolve(level))
                }
              }
            })
          }
        } catch {
          // 回退单用户接口
        }

        const unresolved = chunk.filter(([mid]) => !batchResolved.has(mid))
        if (unresolved.length > 0 && batchResolved.size === 0 && !this.batchDisabled) {
          this.batchDisabled = true
        }
        unresolved.forEach(([mid, listeners]) => {
          this.enqueueSingle(mid).then(level => listeners.forEach(l => l.resolve(level)))
        })
      }
    }

    enqueueSingle(mid) {
      return this.runInQueue(
        this.singleQueue,
        () => this.singleActive,
        delta => {
          this.singleActive += delta
        },
        SINGLE_CONCURRENCY,
        SINGLE_SPACING_MS,
        async () => {
          const cached = this.getCachedLevel(mid)
          if (cached !== null) {
            return cached
          }
          if (Date.now() < this.cooldownUntil) {
            return null
          }
          try {
            const json = await getJsonWithCredentials(
              `https://api.bilibili.com/x/web-interface/card?mid=${mid}`,
            )
            if (json?.code === -412 || json?.code === -799) {
              this.triggerCooldown()
              return null
            }
            if (json?.code === 0) {
              const level = json.data?.card?.level_info?.current_level
              if (level !== undefined) {
                const numLevel = Number(level)
                if (Number.isInteger(numLevel) && numLevel >= 0 && numLevel <= 6) {
                  this.recordLevel(mid, numLevel)
                  if (typeof json.data?.following === 'boolean' && json.data.following) {
                    this.recordFollowing(mid, true)
                  }
                  return numLevel
                }
              }
            }
          } catch {
            // 请求失败不缓存
          }
          return null
        },
      )
    }

    runInQueue(queue, getActive, adjustActive, concurrency, spacingMs, task) {
      return new Promise(resolve => {
        const execute = async () => {
          adjustActive(1)
          try {
            const result = await task()
            resolve(result)
          } finally {
            if (spacingMs > 0) {
              await delay(spacingMs)
            }
            adjustActive(-1)
            const next = queue.shift()
            if (next) {
              next()
            }
          }
        }
        if (getActive() < concurrency) {
          execute()
        } else {
          queue.push(execute)
        }
      })
    }

    flushCacheSync() {
      if (this.persistTimer !== null) {
        window.clearTimeout(this.persistTimer)
        this.persistTimer = null
      }
      this.persistNow()
    }
  }

  const BLOCKED_CLASS = 'be-level-blocked'
  const COLLAPSED_CLASS = 'be-level-blocked-collapsed'
  const TEMP_SHOW_CLASS = 'be-level-temp-show'
  const FORCE_SHOW_CLASS = 'be-level-force-show'
  const COMMENT_EVAL_TOKEN_ATTR = 'data-be-level-comment-eval'

  class CommentBlocker {
    constructor(levelService, initialOptions, onStatsChange) {
      this.levelService = levelService
      this.currentOptions = initialOptions
      this.whitelist = parseWhitelistUids(initialOptions.whitelistUids)
      this.ownUid = getUID() || ''
      this.onStatsChange = onStatsChange
      this.trackedItems = new Set()
      this.initialized = false
      this.active = false
      this.blockedCount = 0
      this.forceShowAll = false
    }

    start() {
      this.active = true
      if (!this.initialized) {
        this.initialized = true
        forEachCommentItem({
          added: commentItem => this.handleTopCommentAdded(commentItem),
          removed: commentItem => this.handleTopCommentRemoved(commentItem),
        })
      }
      this.reEvaluateAll()
    }

    stop() {
      this.active = false
      this.trackedItems.forEach(item => {
        if (item.element) {
          this.clearItemState(item.element)
        }
      })
      this.updateBlockedCount()
    }

    updateOptions(nextOptions) {
      this.currentOptions = nextOptions
      this.whitelist = parseWhitelistUids(nextOptions.whitelistUids)
      this.reEvaluateAll()
    }

    getBlockedCount() {
      return this.blockedCount
    }

    setForceShowAll(showAll) {
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

    handleTopCommentAdded(commentItem) {
      this.registerReplyItem(commentItem)
      commentItem.replies.forEach(reply => this.registerReplyItem(reply))
      commentItem.addEventListener('repliesUpdate', event => {
        const updatedReplies = event.detail ?? []
        updatedReplies.forEach(reply => this.registerReplyItem(reply))
        this.updateBlockedCount()
      })
      this.updateBlockedCount()
    }

    handleTopCommentRemoved(commentItem) {
      if (commentItem) {
        this.trackedItems.delete(commentItem)
        commentItem.replies?.forEach(reply => this.trackedItems.delete(reply))
        this.updateBlockedCount()
      }
    }

    registerReplyItem(item) {
      if (!item?.element) {
        return
      }
      this.trackedItems.add(item)
      this.bindCollapseToggle(item.element)
      if (this.active) {
        this.evaluateReplyItem(item)
      }
    }

    bindCollapseToggle(element) {
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

    extractLevelSync(item) {
      const member = item.frameworkSpecificProps?.member
      const currentLevel = member?.level_info?.current_level
      if (currentLevel !== undefined) {
        const level = Number(currentLevel)
        if (Number.isInteger(level) && level >= 0 && level <= 6) {
          this.levelService.recordLevel(item.userId, level)
          return level
        }
      }
      if (typeof member?.following === 'number' && member.following > 0) {
        this.levelService.recordFollowing(item.userId, true)
      }
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

    async evaluateReplyItem(item) {
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

    applyBlockedState(element, level, userName) {
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

    clearItemState(element) {
      element.classList.remove(BLOCKED_CLASS, COLLAPSED_CLASS, TEMP_SHOW_CLASS, FORCE_SHOW_CLASS)
      element.removeAttribute('data-be-blocked-label')
    }

    updateBlockedCount() {
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

  const VIDEO_BLOCKED_CLASS = 'be-level-video-blocked'
  const VIDEO_COLLAPSED_CLASS = 'be-level-video-collapsed'
  const VIDEO_TEMP_SHOW_CLASS = 'be-level-temp-show'
  const VIDEO_FORCE_SHOW_CLASS = 'be-level-force-show'
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

  class VideoBlocker {
    constructor(levelService, initialOptions, onStatsChange) {
      this.levelService = levelService
      this.currentOptions = initialOptions
      this.whitelist = parseWhitelistUids(initialOptions.whitelistUids)
      this.ownUid = getUID() || ''
      this.onStatsChange = onStatsChange
      this.active = false
      this.blockedCount = 0
      this.forceShowAll = false
      this.domObserver = null
      this.visibilityObserver = null
      this.visibleCards = new WeakSet()
      this.knownCards = new Set()
      this.scanScheduled = false
      this.homePreloadTimer = null
      this.feedsHooked = false
      this.videoPageAbortController = null
      this.dismissedVideoKey = ''
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
      this.knownCards.forEach(card => this.clearCardState(card))
      this.removeVideoPageOverlay()
      this.updateBlockedCount()
    }

    updateOptions(nextOptions) {
      this.currentOptions = nextOptions
      this.whitelist = parseWhitelistUids(nextOptions.whitelistUids)
      this.dismissedVideoKey = ''
      this.reEvaluateAll()
      this.checkCurrentVideoPage()
    }

    getBlockedCount() {
      return this.blockedCount
    }

    setForceShowAll(showAll) {
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

    initVisibilityObserver() {
      if (this.visibilityObserver) {
        return
      }
      this.visibilityObserver = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            const el = entry.target
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

    initDomObserver() {
      if (this.domObserver || !document.body) {
        return
      }
      const [observer] = childListSubtree(document.body, () => {
        this.scheduleScan()
      })
      this.domObserver = observer
    }

    initFeedsHook() {
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

    initVideoPageCheck() {
      if (!matchCurrentPage(videoAndBangumiUrls)) {
        return
      }
      this.videoPageAbortController = new AbortController()
      const { signal } = this.videoPageAbortController
      urlChange(
        () => {
          if (this.active) {
            this.checkCurrentVideoPage()
            this.scheduleScan()
          }
        },
        { signal },
      )
      videoChange(
        () => {
          if (this.active) {
            this.checkCurrentVideoPage()
            this.scheduleScan()
          }
        },
        { signal },
      )
    }

    scheduleScan() {
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

    scanAllCards() {
      this.harvestSearchPiniaStore()
      const rawElements = document.querySelectorAll(CARD_UNIT_SELECTOR)
      const seenUnits = new Set()
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

    normalizeCardUnit(element) {
      if (!element?.isConnected) {
        return null
      }
      if (element.closest('.settings-panel, .bili-header .v-popover-content')) {
        return null
      }
      return element.closest(OUTER_WRAPPER_SELECTOR) || element
    }

    registerCard(card) {
      if (!this.knownCards.has(card)) {
        this.knownCards.add(card)
        this.visibilityObserver?.observe(card)
        this.bindCollapseToggle(card)
      }
      this.evaluateCard(card)
    }

    bindCollapseToggle(card) {
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

    harvestSearchPiniaStore() {
      if (location.hostname !== 'search.bilibili.com') {
        return
      }
      document.querySelectorAll('#app, #i_cecream').forEach(root => {
        const state = root.__vue_app__?.config?.globalProperties?.$pinia?.state?.value
        if (state?.searchResponse) {
          this.levelService.harvestFromPayload(state.searchResponse)
        }
        if (state?.searchTypeResponse) {
          this.levelService.harvestFromPayload(state.searchTypeResponse)
        }
      })
    }

    extractCardMeta(card) {
      const isDynamicCard = Boolean(
        card.matches('.bili-dyn-list__item, .bili-dyn-item') || card.querySelector('.bili-dyn-item'),
      )
      const meta = {
        mid: undefined,
        name: undefined,
        bvid: undefined,
        aid: undefined,
        isDynamicCard,
        isVideoDynamic: false,
      }

      const links = card.querySelectorAll('a[href]')
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

      if (!meta.mid) {
        const midHolder = card.matches('[data-usercard-mid], [data-mid]')
          ? card
          : card.querySelector('[data-usercard-mid], [data-mid]')
        const attrMid =
          midHolder?.getAttribute('data-usercard-mid') ?? midHolder?.getAttribute('data-mid')
        if (attrMid && /^\d+$/.test(attrMid)) {
          meta.mid = attrMid
        }
      }

      this.extractFromVueInstance(card, meta)

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

    extractFromVueInstance(card, meta) {
      const candidates = [card]
      const innerDyn = card.querySelector('.bili-dyn-item, .bili-video-card')
      if (innerDyn) {
        candidates.push(innerDyn)
      }

      for (const el of candidates) {
        try {
          const vue2 = getVue2Data(el)
          if (vue2) {
            this.readObjectIntoMeta(vue2.data ?? vue2.item ?? vue2.videoData ?? vue2, meta)
          }
        } catch {
          // 忽略无子元素异常
        }
        const v3 = el.__vueParentComponent
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

    readObjectIntoMeta(source, meta) {
      if (!source || typeof source !== 'object') {
        return
      }
      if (Array.isArray(source.modules)) {
        for (const mod of source.modules) {
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
      if (source.type === 'DYNAMIC_TYPE_AV') {
        meta.isVideoDynamic = true
      }
      const item = source.item ?? source.video ?? source.info ?? source
      const owner = item?.owner
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

    async evaluateCard(card, force = false) {
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

    applyBlockedState(card, level, upName) {
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

    clearCardState(card) {
      card.classList.remove(
        VIDEO_BLOCKED_CLASS,
        VIDEO_COLLAPSED_CLASS,
        VIDEO_TEMP_SHOW_CLASS,
        VIDEO_FORCE_SHOW_CLASS,
      )
      card.removeAttribute('data-be-video-blocked-label')
      delete card.dataset.beLevelEvalKey
    }

    ensureHomeFeedNotEmpty() {
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
        const container = document.querySelector(
          'main .feed2 .container, .recommended-container_floor-aside > .container',
        )
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

    async checkCurrentVideoPage() {
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
        const owner = unsafeWindow.__INITIAL_STATE__?.videoData?.owner
        if (owner?.mid) {
          return { mid: String(owner.mid), name: String(owner.name || '') }
        }
        const upLink = document.querySelector(
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

      const videoEl = document.querySelector('video, bwp-video')
      if (videoEl && !videoEl.paused) {
        videoEl.pause()
      }
      this.showVideoPageOverlay(ownerInfo.name, level, videoKey)
    }

    showVideoPageOverlay(upName, level, videoKey) {
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

    removeVideoPageOverlay() {
      document.getElementById(VIDEO_PAGE_OVERLAY_ID)?.remove()
    }

    updateBlockedCount() {
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

  class StatsBadge {
    constructor(onToggle) {
      this.visible = true
      this.showAll = false
      this.videoCount = 0
      this.commentCount = 0
      this.badgeEl = null
      this.onToggleCallback = onToggle
    }

    setVisible(visible) {
      this.visible = visible
      this.render()
    }

    updateCounts(videoCount, commentCount) {
      this.videoCount = videoCount
      this.commentCount = commentCount
      this.render()
    }

    destroy() {
      this.showAll = false
      this.onToggleCallback?.(false)
      this.badgeEl?.remove()
      this.badgeEl = null
    }

    render() {
      const total = this.videoCount + this.commentCount
      if (!this.visible || total === 0 || !document.body) {
        if (this.badgeEl) {
          this.badgeEl.style.display = 'none'
        }
        return
      }
      if (!this.badgeEl || !this.badgeEl.isConnected) {
        this.badgeEl = document.getElementById('be-level-blocker-stats-badge') ?? this.createBadge()
      }
      this.badgeEl.style.display = ''
      const parts = []
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

    createBadge() {
      const el = document.createElement('button')
      el.type = 'button'
      el.id = 'be-level-blocker-stats-badge'
      el.title = '点击切换临时显示或恢复等级屏蔽'
      el.addEventListener('click', () => {
        this.showAll = !this.showAll
        this.render()
        this.onToggleCallback?.(this.showAll)
      })
      document.body.appendChild(el)
      return el
    }
  }

  let levelService = null
  let commentBlocker = null
  let videoBlocker = null
  let statsBadge = null
  let active = false

  const watchedOptionKeys = [
    'blockVideos',
    'minUploaderLevel',
    'blockComments',
    'minCommentLevel',
    'hideMode',
    'dynamicFilterScope',
    'blockVideoPage',
    'whitelistFollowing',
    'whitelistUids',
    'showFilteredCount',
    'cacheDays',
  ]

  const syncStats = () => {
    if (!active) {
      return
    }
    statsBadge?.updateCounts(
      videoBlocker?.getBlockedCount() ?? 0,
      commentBlocker?.getBlockedCount() ?? 0,
    )
  }

  const refreshAll = () => {
    if (!active) {
      return
    }
    const { options: currentOptions } = getComponentSettings(componentName)
    levelService?.setCacheDays(currentOptions.cacheDays)
    statsBadge?.setVisible(currentOptions.showFilteredCount)
    commentBlocker?.updateOptions(currentOptions)
    videoBlocker?.updateOptions(currentOptions)
    syncStats()
  }

  const activate = () => {
    if (active) {
      return
    }
    active = true
    const { options: currentOptions } = getComponentSettings(componentName)
    if (!levelService) {
      levelService = new LevelService()
      levelService.installPassiveNetworkHook()
      levelService.onPassiveData(() => {
        if (active) {
          videoBlocker?.reEvaluateAll()
          commentBlocker?.reEvaluateAll()
        }
      })
      window.addEventListener('beforeunload', () => {
        levelService?.flushCacheSync()
      })
    }
    levelService.setCacheDays(currentOptions.cacheDays)

    if (!statsBadge) {
      statsBadge = new StatsBadge(showAll => {
        commentBlocker?.setForceShowAll(showAll)
        videoBlocker?.setForceShowAll(showAll)
      })
    }
    statsBadge.setVisible(currentOptions.showFilteredCount)

    if (!commentBlocker) {
      commentBlocker = new CommentBlocker(levelService, currentOptions, syncStats)
    } else {
      commentBlocker.updateOptions(currentOptions)
    }
    commentBlocker.start()

    if (!videoBlocker) {
      videoBlocker = new VideoBlocker(levelService, currentOptions, syncStats)
    } else {
      videoBlocker.updateOptions(currentOptions)
    }
    videoBlocker.start()

    syncStats()
  }

  const deactivate = () => {
    active = false
    watchedOptionKeys.forEach(key => {
      removeComponentListener(`${componentName}.${key}`, refreshAll)
    })
    commentBlocker?.stop()
    videoBlocker?.stop()
    statsBadge?.destroy()
    levelService?.flushCacheSync()
  }

  const entry = () => {
    activate()
    watchedOptionKeys.forEach(key => {
      addComponentListener(`${componentName}.${key}`, refreshAll)
    })
  }

  const component = defineComponentMetadata({
    name: componentName,
    displayName,
    description: {
      'zh-CN':
        '按 B 站账号等级自动屏蔽低等级 UP 主发布的视频与评论区评论/回复，支持首页推荐、分区、热门排行、搜索、视频相关推荐、动态与评论区（兼容新版 Shadow DOM）。',
    },
    author: {
      name: 'lyfiiu',
      link: 'https://github.com/lyfiiu',
    },
    tags: [componentsTags.utils, componentsTags.feeds],
    options,
    urlExclude: [
      /^https:\/\/passport\.bilibili\.com\//,
      /^https:\/\/player\.bilibili\.com\//,
      /^https:\/\/www\.bilibili\.com\/blackboard\/newplayer\.html/,
    ],
    instantStyles: [
      {
        name: componentName,
        style: DOM_STYLE,
        important: true,
      },
      {
        name: `${componentName}Shadow`,
        style: SHADOW_STYLE,
        shadowDom: true,
      },
    ],
    entry,
    reload: () => {
      activate()
      watchedOptionKeys.forEach(key => {
        addComponentListener(`${componentName}.${key}`, refreshAll)
      })
    },
    unload: deactivate,
  })

  if (typeof exports === 'object' && exports !== null) {
    exports.component = component
  }
  return component
})()
