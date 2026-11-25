import { getJsonWithCredentials } from '@/core/ajax'
import { delay } from '@/core/utils'
import { useScopedConsole } from '@/core/utils/log'
import { displayName } from './options'

const logger = useScopedConsole(displayName)

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

/** [level, expiresAtMs] */
type CacheTuple = [number, number]

export class LevelService {
  private memoryCache = new Map<string, CacheTuple>()
  private followingSet = new Set<string>()
  private bvidToMid = new Map<string, string>()
  private aidToMid = new Map<string, string>()

  private inFlightLevel = new Map<string, Promise<number | null>>()
  private inFlightMidByBvid = new Map<string, Promise<string | null>>()

  private batchPending = new Map<
    string,
    { resolve: (level: number | null) => void }[]
  >()
  private batchTimer: number | null = null
  private batchDisabled = false

  private singleQueue: (() => Promise<void>)[] = []
  private singleActive = 0
  private viewQueue: (() => Promise<void>)[] = []
  private viewActive = 0
  private cooldownUntil = 0

  private cacheDays = 7
  private cacheLoaded = false
  private persistTimer: number | null = null
  private networkHooked = false
  private onPassiveDataCallback?: () => void

  setCacheDays(days: number) {
    this.cacheDays = Math.min(Math.max(Number(days) || 7, 1), 30)
  }

  onPassiveData(callback: () => void) {
    this.onPassiveDataCallback = callback
  }

  private ensureCacheLoaded() {
    if (this.cacheLoaded) {
      return
    }
    this.cacheLoaded = true
    try {
      const raw = localStorage.getItem(CACHE_STORAGE_KEY)
      if (!raw) {
        return
      }
      const parsed = JSON.parse(raw) as Record<string, CacheTuple>
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
      // 忽略损坏的本地缓存
    }
  }

  private schedulePersist() {
    if (this.persistTimer !== null) {
      return
    }
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null
      this.persistNow()
    }, 1500)
  }

  private persistNow() {
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
      const serialized = JSON.stringify(Object.fromEntries(this.memoryCache.entries()))
      localStorage.setItem(CACHE_STORAGE_KEY, serialized)
    } catch {
      // 存储配额不足时清理部分旧数据再跳过
      this.memoryCache.clear()
    }
  }

  private computeTtlMs(level: number): number {
    const dayMs = 86400 * 1000
    if (level === 6) {
      return Math.max(this.cacheDays, 30) * dayMs
    }
    if (level >= 4) {
      return this.cacheDays * dayMs
    }
    return Math.min(this.cacheDays, 1) * dayMs
  }

  /** 读取内存/本地缓存中的等级（无请求） */
  getCachedLevel(mid: string | number | null | undefined): number | null {
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

  /** 写入有效等级缓存（0-6） */
  recordLevel(mid: string | number | null | undefined, level: unknown) {
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
    // LRU 刷新插入顺序
    this.memoryCache.delete(key)
    this.memoryCache.set(key, [numLevel, expiresAt])
    if (!existing || existing[0] !== numLevel) {
      this.schedulePersist()
    }
  }

  recordFollowing(mid: string | number | null | undefined, following: boolean) {
    if (!mid || !following) {
      return
    }
    const key = String(mid)
    if (/^\d+$/.test(key)) {
      this.followingSet.add(key)
    }
  }

  isFollowing(mid: string | number | null | undefined): boolean {
    if (!mid) {
      return false
    }
    return this.followingSet.has(String(mid))
  }

  recordVideoOwner(
    videoId: { bvid?: string; aid?: string | number },
    mid: string | number | null | undefined,
  ) {
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

  getCachedOwnerMid(videoId: { bvid?: string; aid?: string | number }): string | null {
    if (videoId.bvid && this.bvidToMid.has(videoId.bvid)) {
      return this.bvidToMid.get(videoId.bvid) ?? null
    }
    if (videoId.aid && this.aidToMid.has(String(videoId.aid))) {
      return this.aidToMid.get(String(videoId.aid)) ?? null
    }
    return null
  }

  /** 被动拦截 B 站自身发起的 API 响应以零成本提取等级与视频作者 */
  installPassiveNetworkHook() {
    if (this.networkHooked) {
      return
    }
    this.networkHooked = true
    const win = unsafeWindow as unknown as {
      fetch?: typeof window.fetch
      __beLevelBlockerFetchHooked?: boolean
    }
    if (win.fetch && !win.__beLevelBlockerFetchHooked) {
      win.__beLevelBlockerFetchHooked = true
      const originalFetch = win.fetch
      win.fetch = new Proxy(originalFetch, {
        apply: (target, thisArg, args: Parameters<typeof window.fetch>) => {
          const reqUrl = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url ?? ''
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

  private shouldInspectApiUrl(rawUrl: string): boolean {
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

  /** 递归从 B 站接口 JSON 中提取用户等级、关注关系和稿件作者 */
  harvestFromPayload(root: unknown) {
    let foundNew = false
    const visited = new Set<unknown>()

    const walk = (node: unknown, depth: number) => {
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
      const obj = node as Record<string, unknown>
      const mid = obj.mid ?? obj.uid
      const levelInfo = obj.level_info as Record<string, unknown> | undefined
      if (mid && levelInfo && levelInfo.current_level !== undefined) {
        const before = this.getCachedLevel(mid as string | number)
        this.recordLevel(mid as string | number, levelInfo.current_level)
        if (before === null) {
          foundNew = true
        }
      }
      if (mid && typeof obj.following === 'boolean' && obj.following) {
        this.recordFollowing(mid as string | number, true)
      }
      if (obj.owner && typeof obj.owner === 'object') {
        const owner = obj.owner as Record<string, unknown>
        if (owner.mid && (obj.bvid || obj.aid || obj.id)) {
          this.recordVideoOwner(
            {
              bvid: typeof obj.bvid === 'string' ? obj.bvid : undefined,
              aid: (obj.aid ?? obj.id) as string | number | undefined,
            },
            owner.mid as string | number,
          )
          foundNew = true
        }
      }
      if (typeof obj.bvid === 'string' && obj.mid) {
        this.recordVideoOwner({ bvid: obj.bvid, aid: obj.aid as string | number }, obj.mid as string | number)
        foundNew = true
      }
      const values = Object.values(obj)
      for (let i = 0; i < values.length; i += 1) {
        walk(values[i], depth + 1)
      }
    }

    walk(root, 0)
    if (foundNew) {
      this.onPassiveDataCallback?.()
    }
  }

  /** 获取用户等级（优先缓存 -> 批量接口 -> 单用户接口） */
  getLevel(mid: string | number): Promise<number | null> {
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
    const promise = new Promise<number | null>(resolve => {
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

  /** 在 DOM 与前端状态均缺失 mid 时，通过 bvid 反查 UP 主 mid */
  resolveMidByBvid(bvid: string): Promise<string | null> {
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
          // 网络错误时不缓存失败结果
        }
        return null
      },
    ).finally(() => {
      this.inFlightMidByBvid.delete(bvid)
    })
    this.inFlightMidByBvid.set(bvid, promise)
    return promise
  }

  private triggerCooldown() {
    this.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS
    logger.warn('触发风控限流保护，暂停等级查询 20 秒')
  }

  private scheduleBatchFlush() {
    if (this.batchTimer !== null) {
      return
    }
    this.batchTimer = window.setTimeout(() => {
      this.batchTimer = null
      this.flushBatch()
    }, BATCH_DEBOUNCE_MS)
  }

  private async flushBatch() {
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
      let batchResolved = new Set<string>()
      try {
        const json = await getJsonWithCredentials(
          `https://api.vc.bilibili.com/account/v1/user/cards?uids=${uids}`,
        )
        if (json?.code === -412 || json?.code === -799) {
          this.triggerCooldown()
        } else if (json?.code === -101) {
          // 未登录状态无法调用批量名片接口，后续直接走单用户公开名片接口
          this.batchDisabled = true
        } else if (json?.code === 0 && Array.isArray(json.data)) {
          json.data.forEach((item: Record<string, unknown>) => {
            const itemMid = item?.mid ?? (item?.card as Record<string, unknown> | undefined)?.mid
            const levelInfo =
              (item?.level_info as Record<string, unknown> | undefined) ??
              ((item?.card as Record<string, unknown> | undefined)?.level_info as
                | Record<string, unknown>
                | undefined)
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
        // 批量请求异常时回退到单用户接口
      }

      const unresolved = chunk.filter(([mid]) => !batchResolved.has(mid))
      if (unresolved.length > 0 && batchResolved.size === 0 && !this.batchDisabled) {
        // 如果批量接口返回不含 level_info，停用批量接口避免重复无效请求
        this.batchDisabled = true
      }
      unresolved.forEach(([mid, listeners]) => {
        this.enqueueSingle(mid).then(level => listeners.forEach(l => l.resolve(level)))
      })
    }
  }

  private enqueueSingle(mid: string): Promise<number | null> {
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
            const card = json.data?.card as Record<string, unknown> | undefined
            const level = (card?.level_info as Record<string, unknown> | undefined)?.current_level
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
          // 请求失败不写入缓存
        }
        return null
      },
    )
  }

  private runInQueue<T>(
    queue: (() => Promise<void>)[],
    getActive: () => number,
    adjustActive: (delta: number) => void,
    concurrency: number,
    spacingMs: number,
    task: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>(resolve => {
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
