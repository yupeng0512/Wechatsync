/**
 * 适配器系统初始化
 */
import {
  adapterRegistry,
  type PlatformAdapter,
  type PlatformMeta,
  type Article,
  type SyncResult,
} from '@wechatsync/core'
import { createExtensionRuntime } from '../runtime/extension'
import { createLogger } from '../lib/logger'
import {
  trackSyncStart,
  trackPlatformSync,
  trackSyncComplete,
  inferErrorType,
  trackPlatformCombination,
  trackUsageTime,
  updateCumulativeStats,
  trackMilestone,
  trackAuthCheck,
} from '../lib/analytics'

// 导入所有代码适配器
import { ZhihuAdapter } from './zhihu'
import { JuejinAdapter } from './juejin'
import { JianshuAdapter } from './jianshu'
import { ToutiaoAdapter } from './toutiao'
import { WeiboAdapter } from './weibo'
import { BilibiliAdapter } from './bilibili'
import { BaijiahaoAdapter } from './baijiahao'
import { CSDNAdapter } from './csdn'
import { YuqueAdapter } from './yuque'
import { DoubanAdapter } from './douban'
import { SohuAdapter } from './sohu'
import { XueqiuAdapter } from './xueqiu'
import { WeixinAdapter } from './weixin'
import { WoshipmAdapter } from './woshipm'
import { DaYuAdapter } from './dayu'

// 所有适配器类列表
const ADAPTER_CLASSES = [
  ZhihuAdapter,
  JuejinAdapter,
  // JianshuAdapter,
  ToutiaoAdapter,
  WeiboAdapter,
  BilibiliAdapter,
  BaijiahaoAdapter,
  CSDNAdapter,
  YuqueAdapter,
  DoubanAdapter,
  SohuAdapter,
  XueqiuAdapter,
  WeixinAdapter,
  WoshipmAdapter,
  DaYuAdapter,
] as const

// 适配器注册条目 (类型安全)
interface AdapterEntry {
  meta: PlatformMeta
  factory: () => PlatformAdapter
}

// 生成适配器注册条目
const adapterEntries: AdapterEntry[] = ADAPTER_CLASSES.map(AdapterClass => ({
  meta: new AdapterClass().meta,
  factory: () => new AdapterClass(),
}))

const logger = createLogger('WechatSync')

// 运行时实例
const runtime = createExtensionRuntime()

// 是否已初始化
let initialized = false

/**
 * 初始化适配器系统
 */
export async function initAdapters(): Promise<void> {
  if (initialized) return

  // 设置运行时
  adapterRegistry.setRuntime(runtime)

  // 注册所有适配器
  for (const entry of adapterEntries) {
    try {
      adapterRegistry.register(entry)
    } catch (error) {
      logger.error('Failed to register adapter:', error)
    }
  }

  initialized = true
}

/**
 * 获取适配器
 */
export async function getAdapter(platformId: string): Promise<PlatformAdapter | null> {
  await initAdapters()
  return adapterRegistry.get(platformId)
}

/**
 * 获取所有平台元信息
 */
export function getAllPlatformMetas() {
  return adapterRegistry.getAllMeta()
}

/**
 * 检查平台登录状态
 */
export async function checkPlatformAuth(platformId: string) {
  const adapter = await getAdapter(platformId)
  if (!adapter) {
    return { isAuthenticated: false, error: 'Platform not found' }
  }
  return adapter.checkAuth()
}

// 缓存配置
const AUTH_CACHE_KEY = 'authCache'
const AUTH_CACHE_TTL_AUTHENTICATED = 5 * 60 * 1000 // 已登录：5 分钟缓存
const AUTH_CACHE_TTL_UNAUTHENTICATED = 30 * 1000 // 未登录：30 秒缓存（用户可能随时登录）

interface AuthCacheItem {
  isAuthenticated: boolean
  username?: string
  error?: string
  timestamp: number
}

interface AuthCache {
  [platformId: string]: AuthCacheItem
}

/**
 * 获取缓存的认证状态
 */
async function getCachedAuth(): Promise<AuthCache> {
  try {
    const storage = await chrome.storage.local.get(AUTH_CACHE_KEY)
    return storage[AUTH_CACHE_KEY] || {}
  } catch {
    return {}
  }
}

/**
 * 保存认证状态到缓存
 */
async function setCachedAuth(cache: AuthCache): Promise<void> {
  await chrome.storage.local.set({ [AUTH_CACHE_KEY]: cache })
}

/**
 * 清除认证缓存
 */
export async function clearAuthCache(): Promise<void> {
  await chrome.storage.local.remove(AUTH_CACHE_KEY)
}

/**
 * 检查所有平台登录状态（带缓存）
 */
export async function checkAllPlatformsAuth(forceRefresh = false) {
  await initAdapters()

  const metas = adapterRegistry.getAllMeta()
  const cache = await getCachedAuth()
  const now = Date.now()
  const results = []

  logger.debug(' Checking auth for platforms:', metas.map(m => m.id), forceRefresh ? '(force refresh)' : '')

  for (const meta of metas) {
    // 检查缓存是否有效（未登录用短缓存，已登录用长缓存）
    const cached = cache[meta.id]
    const cacheTTL = cached?.isAuthenticated ? AUTH_CACHE_TTL_AUTHENTICATED : AUTH_CACHE_TTL_UNAUTHENTICATED
    const cacheValid = cached && (now - cached.timestamp < cacheTTL) && !forceRefresh

    if (cacheValid) {
      logger.debug(` Using cached auth for ${meta.id} (TTL: ${cacheTTL / 1000}s)`)
      results.push({
        ...meta,
        isAuthenticated: cached.isAuthenticated,
        username: cached.username,
        error: cached.error,
      })
      continue
    }

    // 缓存过期或强制刷新，重新检查
    try {
      const adapter = await adapterRegistry.get(meta.id)
      if (adapter) {
        logger.debug(` Checking auth for ${meta.id}...`)
        const auth = await adapter.checkAuth()
        logger.debug(` ${meta.id} auth result:`, auth)

        // 追踪认证检查
        trackAuthCheck(meta.id, auth.isAuthenticated).catch(() => {})

        // 更新缓存
        cache[meta.id] = {
          isAuthenticated: auth.isAuthenticated,
          username: auth.username,
          error: auth.error,
          timestamp: now,
        }

        results.push({
          ...meta,
          isAuthenticated: auth.isAuthenticated,
          username: auth.username,
          error: auth.error,
        })
      }
    } catch (error) {
      logger.error(`${meta.id} auth error:`, error)

      // 缓存错误状态
      cache[meta.id] = {
        isAuthenticated: false,
        error: (error as Error).message,
        timestamp: now,
      }

      results.push({
        ...meta,
        isAuthenticated: false,
        error: (error as Error).message,
      })
    }
  }

  // 保存更新后的缓存
  await setCachedAuth(cache)

  // 追踪首次平台登录里程碑
  const hasLoggedIn = results.some(r => r.isAuthenticated)
  if (hasLoggedIn) {
    trackMilestone('first_platform_login').catch(() => {})
  }

  return results
}

/**
 * 图片进度回调类型
 */
export type ImageProgressCallback = (platform: string, current: number, total: number) => void

/**
 * 同步阶段类型
 */
export type SyncStage = 'starting' | 'uploading_images' | 'saving' | 'completed' | 'failed'

/**
 * 详细同步进度类型
 */
export interface SyncDetailProgress {
  platform: string
  platformName: string
  stage: SyncStage
  // 图片上传进度（uploading_images 阶段）
  imageProgress?: { current: number; total: number }
  // 同步结果（completed/failed 阶段）
  result?: SyncResult
  // 错误信息（failed 阶段）
  error?: string
}

/**
 * 同步进度回调类型
 */
export interface SyncCallbacks {
  onResult?: (result: SyncResult) => void
  onImageProgress?: ImageProgressCallback
  // 新增：详细进度回调
  onDetailProgress?: (progress: SyncDetailProgress) => void
}

/**
 * 同步文章到平台
 */
export async function syncToPlatform(
  platformId: string,
  article: Article,
  options?: { draftOnly?: boolean },
  onImageProgress?: ImageProgressCallback
): Promise<SyncResult> {
  const adapter = await getAdapter(platformId)
  if (!adapter) {
    return {
      platform: platformId,
      success: false,
      error: 'Platform not found',
      timestamp: Date.now(),
    }
  }

  // 默认只保存草稿
  return adapter.publish(article, {
    draftOnly: options?.draftOnly ?? true,
    onImageProgress: onImageProgress
      ? (current: number, total: number) => onImageProgress(platformId, current, total)
      : undefined,
  })
}

// 并发数量限制
const CONCURRENCY_LIMIT = 3

// 同步取消控制
let syncAbortController: AbortController | null = null

/**
 * 取消正在进行的同步
 */
export function cancelSync(): boolean {
  if (syncAbortController) {
    syncAbortController.abort()
    syncAbortController = null
    return true
  }
  return false
}

/**
 * 检查同步是否正在进行
 */
export function isSyncing(): boolean {
  return syncAbortController !== null
}

/**
 * 同步文章到多个平台（并行，最多同时 3 个，支持取消）
 */
export async function syncToMultiplePlatforms(
  platformIds: string[],
  article: Article,
  callbacks?: SyncCallbacks,
  source = 'popup' // 来源：popup, weixin, weixin-editor, mcp 等
): Promise<SyncResult[]> {
  // 创建新的取消控制器
  syncAbortController = new AbortController()
  const signal = syncAbortController.signal

  const results: SyncResult[] = []
  const startTime = Date.now()
  let cancelled = false

  // 追踪同步开始
  trackSyncStart(source, platformIds).catch(() => {})

  // 追踪使用时段
  trackUsageTime().catch(() => {})

  // 追踪平台组合
  trackPlatformCombination(platformIds).catch(() => {})

  // 追踪首次同步尝试里程碑
  trackMilestone('first_sync_attempt').catch(() => {})

  // 获取平台名称的辅助函数
  const getPlatformName = (platformId: string): string => {
    const meta = getAllPlatformMetas().find(p => p.id === platformId)
    return meta?.name || platformId
  }

  // 同步单个平台并追踪
  const syncOne = async (platformId: string): Promise<SyncResult> => {
    const platformName = getPlatformName(platformId)

    // 检查是否已取消
    if (signal.aborted) {
      const cancelledResult: SyncResult = {
        platform: platformId,
        success: false,
        error: '已取消',
        timestamp: Date.now(),
      }
      callbacks?.onDetailProgress?.({
        platform: platformId,
        platformName,
        stage: 'failed',
        result: cancelledResult,
        error: '已取消',
      })
      return cancelledResult
    }

    // 通知开始同步
    callbacks?.onDetailProgress?.({
      platform: platformId,
      platformName,
      stage: 'starting',
    })

    const platformStartTime = Date.now()

    // 包装图片进度回调，同时触发 onDetailProgress
    const wrappedImageProgress: ImageProgressCallback | undefined = callbacks?.onImageProgress || callbacks?.onDetailProgress
      ? (platform, current, total) => {
          callbacks?.onImageProgress?.(platform, current, total)
          callbacks?.onDetailProgress?.({
            platform: platformId,
            platformName,
            stage: 'uploading_images',
            imageProgress: { current, total },
          })
          // 图片上传完成后，切换到 saving 阶段
          if (current === total && total > 0) {
            callbacks?.onDetailProgress?.({
              platform: platformId,
              platformName,
              stage: 'saving',
            })
          }
        }
      : undefined

    const result = await syncToPlatform(
      platformId,
      article,
      undefined,
      wrappedImageProgress
    )

    // 通知完成/失败
    callbacks?.onDetailProgress?.({
      platform: platformId,
      platformName,
      stage: result.success ? 'completed' : 'failed',
      result,
      error: result.error,
    })

    callbacks?.onResult?.(result)

    // 追踪单个平台同步结果
    const platformDuration = Date.now() - platformStartTime
    trackPlatformSync(source, platformId, result.success, {
      draftOnly: result.draftOnly,
      errorType: result.error ? inferErrorType(result.error) : undefined,
      duration: platformDuration,
    }).catch(() => {})

    return result
  }

  // 分批并行执行（每批最多 CONCURRENCY_LIMIT 个）
  for (let i = 0; i < platformIds.length; i += CONCURRENCY_LIMIT) {
    // 每批前检查是否取消
    if (signal.aborted) {
      cancelled = true
      // 剩余平台标记为已取消
      const remaining = platformIds.slice(i)
      for (const platformId of remaining) {
        const cancelledResult: SyncResult = {
          platform: platformId,
          success: false,
          error: '已取消',
          timestamp: Date.now(),
        }
        results.push(cancelledResult)
        callbacks?.onResult?.(cancelledResult)
      }
      break
    }

    const batch = platformIds.slice(i, i + CONCURRENCY_LIMIT)
    const batchResults = await Promise.all(batch.map(syncOne))
    results.push(...batchResults)
  }

  // 清除控制器
  syncAbortController = null

  // 追踪同步完成
  const successCount = results.filter(r => r.success).length
  const cancelledCount = results.filter(r => r.error === '已取消').length
  trackSyncComplete({
    source,
    total: results.length,
    success: successCount,
    failed: results.length - successCount - cancelledCount,
    platforms: platformIds,
    duration: Date.now() - startTime,
  }).catch(() => {})

  // 追踪首次同步成功里程碑
  if (successCount > 0) {
    trackMilestone('first_sync_success').catch(() => {})
  }

  // 更新累计统计（会自动触发里程碑检查）
  updateCumulativeStats(platformIds).catch(() => {})

  return results
}
