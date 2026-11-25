import { defineComponentMetadata } from '@/components/define'
import { ComponentEntry } from '@/components/types'
import { addComponentListener, getComponentSettings, removeComponentListener } from '@/core/settings'
import { CommentBlocker } from './comment-blocker'
import { LevelService } from './level-service'
import { componentName, displayName, LevelBlockerOptions, options } from './options'
import { StatsBadge } from './stats-badge'
import { VideoBlocker } from './video-blocker'

let levelService: LevelService | null = null
let commentBlocker: CommentBlocker | null = null
let videoBlocker: VideoBlocker | null = null
let statsBadge: StatsBadge | null = null
let active = false

const watchedOptionKeys: (keyof LevelBlockerOptions)[] = [
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

const refreshAll = () => {
  if (!active) {
    return
  }
  const { options: currentOptions } = getComponentSettings<LevelBlockerOptions>(componentName)
  levelService?.setCacheDays(currentOptions.cacheDays)
  statsBadge?.setVisible(currentOptions.showFilteredCount)
  commentBlocker?.updateOptions(currentOptions)
  videoBlocker?.updateOptions(currentOptions)
  statsBadge?.updateCounts(
    videoBlocker?.getBlockedCount() ?? 0,
    commentBlocker?.getBlockedCount() ?? 0,
  )
}

const syncStats = () => {
  if (!active) {
    return
  }
  statsBadge?.updateCounts(
    videoBlocker?.getBlockedCount() ?? 0,
    commentBlocker?.getBlockedCount() ?? 0,
  )
}

const activate = () => {
  if (active) {
    return
  }
  active = true
  const { options: currentOptions } = getComponentSettings<LevelBlockerOptions>(componentName)
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

const entry: ComponentEntry<LevelBlockerOptions> = () => {
  activate()
  watchedOptionKeys.forEach(key => {
    addComponentListener(`${componentName}.${key}`, refreshAll)
  })
}

export const component = defineComponentMetadata({
  name: componentName,
  displayName,
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
      style: () => import('./level-blocker.scss'),
      important: true,
    },
    {
      name: `${componentName}Shadow`,
      style: () => import('./level-blocker-shadow.scss'),
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
