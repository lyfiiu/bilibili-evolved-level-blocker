import { defineOptionsMetadata, OptionsOfMetadata } from '@/components/define'
import { getNumberValidator } from '@/core/utils'

export enum HideMode {
  Hidden = '完全隐藏',
  Collapsed = '折叠占位提示',
}

export enum DynamicFilterScope {
  All = '全部动态',
  VideoOnly = '仅视频动态',
}

export const componentName = 'levelBlocker'
export const displayName = '等级屏蔽器'

export const options = defineOptionsMetadata({
  blockVideos: {
    displayName: '屏蔽低等级 UP 主视频',
    defaultValue: true,
  },
  minUploaderLevel: {
    displayName: '最低 UP 主等级',
    defaultValue: 3,
    slider: {
      min: 0,
      max: 6,
      step: 1,
    },
    validator: getNumberValidator(0, 6),
  },
  blockComments: {
    displayName: '屏蔽低等级评论区评论',
    defaultValue: true,
  },
  minCommentLevel: {
    displayName: '最低评论用户等级',
    defaultValue: 2,
    slider: {
      min: 0,
      max: 6,
      step: 1,
    },
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
    slider: {
      min: 1,
      max: 30,
      step: 1,
    },
    validator: getNumberValidator(1, 30),
  },
})

export type LevelBlockerOptions = OptionsOfMetadata<typeof options>

/** 解析白名单 UID 文本 */
export const parseWhitelistUids = (raw: string): Set<string> => {
  const result = new Set<string>()
  if (!raw) {
    return result
  }
  const tokens = raw.split(/[\s,，;；]+/)
  tokens.forEach(token => {
    const trimmed = token.trim()
    if (/^\d+$/.test(trimmed)) {
      result.add(trimmed)
    }
  })
  return result
}
