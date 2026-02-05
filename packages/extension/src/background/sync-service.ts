/**
 * Sync Service - 同步服务模块
 *
 * 提供完整的文章同步功能，支持 DSL 平台和 CMS 账户。
 * 主要供 MCP 使用，避免 service worker 自己给自己发消息的问题。
 */
import {
  syncToMultiplePlatforms,
  getAllPlatformMetas,
  type SyncDetailProgress,
} from '../adapters'
import * as wordpressAdapter from '../adapters/cms/wordpress'
import * as metaweblogAdapter from '../adapters/cms/metaweblog'
import { createLogger } from '../lib/logger'

const logger = createLogger('SyncService')

// 同步结果类型
export interface SyncResult {
  platform: string
  platformName?: string
  success: boolean
  postUrl?: string
  draftOnly?: boolean
  error?: string
}

// 同步状态类型
type SyncHistoryStatus = 'syncing' | 'completed' | 'failed' | 'cancelled'

// 同步状态
interface ActiveSyncState {
  syncId: string
  status: 'syncing' | 'completed' | 'failed' | 'cancelled'
  article: {
    title: string
    cover?: string
    content?: string
    html?: string
    markdown?: string
  } | null
  selectedPlatforms: string[]
  results: SyncResult[]
  startTime: number
}

// 历史记录项
interface SyncHistoryItem {
  id: string
  status: SyncHistoryStatus
  title: string
  cover?: string
  platforms: string[]
  results: SyncResult[]
  startTime: number
  endTime?: number
}

// 同步配置
interface SyncOptions {
  skipHistory?: boolean
  source?: string
}

// 进度回调
export interface SyncProgressCallbacks {
  onResult?: (result: SyncResult) => void
  onImageProgress?: (platform: string, current: number, total: number) => void
  onDetailProgress?: (progress: SyncDetailProgress) => void
}

const SYNC_STATE_KEY = 'activeSyncState'
const MAX_HISTORY_ITEMS = 25

// Badge 颜色
const BADGE_COLORS = {
  syncing: '#3B82F6',   // 蓝色
  success: '#22C55E',   // 绿色
  error: '#EF4444',     // 红色
  partial: '#F59E0B',   // 橙色
}

/**
 * 生成唯一同步ID
 */
export function generateSyncId(): string {
  return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 更新扩展 Badge
 */
async function updateBadge(state: ActiveSyncState | null) {
  if (!state) {
    await chrome.action.setBadgeText({ text: '' })
    return
  }

  const completed = state.results.length
  const total = state.selectedPlatforms.length

  if (state.status === 'syncing') {
    await chrome.action.setBadgeText({ text: `${completed}/${total}` })
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.syncing })
  } else if (state.status === 'completed') {
    const successCount = state.results.filter(r => r.success).length
    const failedCount = total - successCount

    if (failedCount === 0) {
      await chrome.action.setBadgeText({ text: '✓' })
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.success })
    } else if (successCount === 0) {
      await chrome.action.setBadgeText({ text: '!' })
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.error })
    } else {
      await chrome.action.setBadgeText({ text: `${successCount}` })
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.partial })
    }

    // 8秒后清除 badge
    setTimeout(async () => {
      const storage = await chrome.storage.local.get(SYNC_STATE_KEY)
      if (storage[SYNC_STATE_KEY]?.status === 'completed') {
        await chrome.action.setBadgeText({ text: '' })
      }
    }, 8000)
  } else if (state.status === 'failed' || state.status === 'cancelled') {
    await chrome.action.setBadgeText({ text: '!' })
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.error })

    setTimeout(async () => {
      const storage = await chrome.storage.local.get(SYNC_STATE_KEY)
      if (storage[SYNC_STATE_KEY]?.status === 'failed' || storage[SYNC_STATE_KEY]?.status === 'cancelled') {
        await chrome.action.setBadgeText({ text: '' })
      }
    }, 8000)
  }
}

/**
 * 保存同步状态
 */
async function saveSyncState(state: ActiveSyncState) {
  await chrome.storage.local.set({ [SYNC_STATE_KEY]: state })
  await updateBadge(state)
}

/**
 * 创建同步历史记录
 */
async function createHistoryItem(
  syncId: string,
  article: { title: string; cover?: string },
  platforms: string[]
): Promise<void> {
  try {
    const storage = await chrome.storage.local.get('syncHistory')
    const existingHistory: SyncHistoryItem[] = storage.syncHistory || []

    const historyItem: SyncHistoryItem = {
      id: syncId,
      status: 'syncing',
      title: article.title || '未知文章',
      cover: article.cover,
      platforms,
      results: [],
      startTime: Date.now(),
    }

    const newHistory = [historyItem, ...existingHistory].slice(0, MAX_HISTORY_ITEMS)
    await chrome.storage.local.set({ syncHistory: newHistory })
    logger.info('History created:', syncId, historyItem.title)
  } catch (error) {
    logger.error('Failed to create history:', error)
  }
}

/**
 * 更新同步历史记录
 */
async function updateHistoryItem(
  syncId: string,
  status: SyncHistoryStatus,
  results: SyncResult[],
  allPlatformMetas: Array<{ id: string; name: string }>
): Promise<void> {
  try {
    const storage = await chrome.storage.local.get('syncHistory')
    const existingHistory: SyncHistoryItem[] = storage.syncHistory || []

    const resultsWithNames = results.map(r => ({
      ...r,
      platformName: r.platformName || allPlatformMetas.find(p => p.id === r.platform)?.name || r.platform,
    }))

    const updatedHistory = existingHistory.map(item => {
      if (item.id === syncId) {
        return {
          ...item,
          status,
          results: resultsWithNames,
          endTime: Date.now(),
        }
      }
      return item
    })

    await chrome.storage.local.set({ syncHistory: updatedHistory })
    logger.info('History updated:', syncId, status)
  } catch (error) {
    logger.error('Failed to update history:', error)
  }
}

/**
 * 执行文章同步
 *
 * @param article 文章数据
 * @param platforms 目标平台ID列表
 * @param options 同步选项
 * @param callbacks 进度回调
 * @returns 同步结果
 */
export async function performSync(
  article: {
    title: string
    content?: string
    html?: string
    markdown?: string
    cover?: string
  },
  platforms: string[],
  options: SyncOptions = {},
  callbacks: SyncProgressCallbacks = {}
): Promise<{ results: SyncResult[]; syncId: string }> {
  const { skipHistory = false, source = 'mcp' } = options
  const { onResult, onImageProgress, onDetailProgress } = callbacks

  const allPlatformMetas = getAllPlatformMetas()
  const platformNameById = new Map(allPlatformMetas.map(meta => [meta.id, meta.name]))
  const syncId = generateSyncId()

  // 规范化文章对象，确保必需字段有默认值
  const normalizedArticle = {
    title: article.title,
    content: article.content || article.html || '',
    html: article.html || article.content || '',
    markdown: article.markdown || '',
    cover: article.cover,
  }

  // 获取 CMS 账户信息以区分 DSL 和 CMS
  const cmsStorage = await chrome.storage.local.get('cmsAccounts')
  const cmsAccounts = cmsStorage.cmsAccounts || []
  const cmsAccountIds = new Set(cmsAccounts.map((a: any) => a.id))

  // 分离 DSL 平台和 CMS 账户
  const dslPlatformIds = platforms.filter((id: string) => !cmsAccountIds.has(id))
  const cmsPlatformIds = platforms.filter((id: string) => cmsAccountIds.has(id))

  // 初始化同步状态
  const syncState: ActiveSyncState = {
    syncId,
    status: 'syncing',
    article: {
      title: normalizedArticle.title,
      cover: normalizedArticle.cover,
      content: normalizedArticle.content,
      html: normalizedArticle.html,
      markdown: normalizedArticle.markdown,
    },
    selectedPlatforms: platforms,
    results: [],
    startTime: Date.now(),
  }
  await saveSyncState(syncState)

  // 创建历史记录
  if (!skipHistory) {
    await createHistoryItem(syncId, normalizedArticle, platforms)
  }

  const allResults: SyncResult[] = []

  // 同步到 DSL 平台
  if (dslPlatformIds.length > 0) {
    await syncToMultiplePlatforms(dslPlatformIds, normalizedArticle, {
      onResult: (result) => {
        const resultWithName: SyncResult = {
          ...result,
          platformName: platformNameById.get(result.platform) || result.platform,
        }
        syncState.results.push(resultWithName)
        allResults.push(resultWithName)
        saveSyncState(syncState).catch(() => {})

        onResult?.(resultWithName)
      },
      onImageProgress: (platform, current, total) => {
        onImageProgress?.(platform, current, total)
      },
      onDetailProgress: (progress: SyncDetailProgress) => {
        onDetailProgress?.(progress)
      },
    }, source)
  }

  // 同步到 CMS 账户
  for (const accountId of cmsPlatformIds) {
    const account = cmsAccounts.find((a: any) => a.id === accountId)
    if (!account) {
      const cmsResult: SyncResult = {
        platform: accountId,
        platformName: platformNameById.get(accountId) || accountId,
        success: false,
        error: 'CMS 账户不存在',
      }
      allResults.push(cmsResult)
      syncState.results.push(cmsResult)
      saveSyncState(syncState).catch(() => {})
      onResult?.(cmsResult)
      onDetailProgress?.({ platform: accountId, platformName: cmsResult.platformName || accountId, stage: 'failed', error: cmsResult.error })
      continue
    }

    onDetailProgress?.({ platform: accountId, platformName: account.name, stage: 'starting' })

    try {
      const passwordStorage = await chrome.storage.local.get(`cms_pwd_${accountId}`)
      const password = passwordStorage[`cms_pwd_${accountId}`]

      if (!password) {
        const cmsResult: SyncResult = {
          platform: accountId,
          platformName: account.name,
          success: false,
          error: '密码未找到',
        }
        allResults.push(cmsResult)
        syncState.results.push(cmsResult)
        saveSyncState(syncState).catch(() => {})
        onResult?.(cmsResult)
        onDetailProgress?.({ platform: accountId, platformName: account.name, stage: 'failed', error: '密码未找到' })
        continue
      }

      onDetailProgress?.({ platform: accountId, platformName: account.name, stage: 'saving' })

      const credentials = { url: account.url, username: account.username, password }
      let result

      switch (account.type) {
        case 'wordpress':
          result = await wordpressAdapter.publish(credentials, normalizedArticle, { draftOnly: true })
          break
        case 'typecho':
          result = await metaweblogAdapter.publishToTypecho(credentials, normalizedArticle, { draftOnly: true })
          break
        case 'metaweblog':
          result = await metaweblogAdapter.publish(credentials, normalizedArticle, { draftOnly: true })
          break
        default:
          result = { success: false, error: '不支持的 CMS 类型' }
      }

      const cmsResult: SyncResult = {
        platform: accountId,
        platformName: account.name,
        success: result.success,
        postUrl: result.postUrl,
        draftOnly: true,
        error: result.error,
      }
      allResults.push(cmsResult)
      syncState.results.push(cmsResult)
      saveSyncState(syncState).catch(() => {})
      onResult?.(cmsResult)
      onDetailProgress?.({
        platform: accountId,
        platformName: account.name,
        stage: result.success ? 'completed' : 'failed',
        error: result.error,
      })
    } catch (error) {
      const cmsResult: SyncResult = {
        platform: accountId,
        platformName: account.name,
        success: false,
        error: (error as Error).message,
      }
      allResults.push(cmsResult)
      syncState.results.push(cmsResult)
      saveSyncState(syncState).catch(() => {})
      onResult?.(cmsResult)
      onDetailProgress?.({ platform: accountId, platformName: account.name, stage: 'failed', error: (error as Error).message })
    }
  }

  // 确定最终状态
  const successCount = allResults.filter(r => r.success).length
  const failedCount = allResults.length - successCount
  const finalStatus: SyncHistoryStatus =
    allResults.length === 0 && platforms.length > 0
      ? 'failed'
      : failedCount === allResults.length && allResults.length > 0
        ? 'failed'
        : 'completed'

  // 更新为完成状态
  syncState.status = finalStatus
  await saveSyncState(syncState)

  // 更新历史记录
  if (!skipHistory) {
    await updateHistoryItem(syncId, finalStatus, allResults, allPlatformMetas)
  }

  return { results: allResults, syncId }
}
