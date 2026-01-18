/**
 * 头条适配器
 */
import { CodeAdapter, type ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../../types'
import type { PublishOptions } from '../types'
import { markdownToHtml } from '../../lib'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Toutiao')

export class ToutiaoAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'toutiao',
    name: '头条',
    icon: 'https://sf1-ttcdn-tos.pstatp.com/obj/ttfe/pgcfe/sz/mp_logo.png',
    homepage: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    capabilities: ['article', 'draft', 'image_upload', 'cover'],
  }

  private headerRuleIds: string[] = []

  /**
   * 设置动态请求头规则 (CORS)
   */
  private async setupHeaderRules(): Promise<void> {
    if (this.headerRuleIds.length > 0) return
    if (!this.runtime.headerRules) return

    const ruleId = await this.runtime.headerRules.add({
      urlFilter: '*://mp.toutiao.com/*',
      headers: {
        'Origin': 'https://mp.toutiao.com',
        'Referer': 'https://mp.toutiao.com/profile_v4/graphic/publish',
      },
      resourceTypes: ['xmlhttprequest'],
    })
    this.headerRuleIds.push(ruleId)

    logger.debug('Header rules added:', this.headerRuleIds)
  }

  /**
   * 清除动态请求头规则
   */
  private async clearHeaderRules(): Promise<void> {
    if (!this.runtime.headerRules) return
    for (const ruleId of this.headerRuleIds) {
      await this.runtime.headerRules.remove(ruleId)
    }
    this.headerRuleIds = []
    logger.debug('Header rules cleared')
  }

  async checkAuth(): Promise<AuthResult> {
    try {
      const res = await this.get<{
        data?: { user?: { id: number; screen_name: string; https_avatar_url: string } }
      }>('https://mp.toutiao.com/mp/agw/media/get_media_info')

      logger.debug('checkAuth response:', res)

      if (res.data?.user?.id) {
        return {
          isAuthenticated: true,
          userId: String(res.data.user.id),
          username: res.data.user.screen_name,
          avatar: res.data.user.https_avatar_url,
        }
      }

      return { isAuthenticated: false }
    } catch (error) {
      logger.debug('checkAuth: not logged in -', error)
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  /**
   * 获取 x-secsdk-csrf-token
   */
  private async getCsrfToken(): Promise<string> {
    const response = await this.runtime.fetch('https://mp.toutiao.com/ttwid/check/', {
      method: 'HEAD',
      credentials: 'include',
      headers: {
        'x-secsdk-csrf-request': '1',
        'x-secsdk-csrf-version': '1.2.22',
      },
    })
    // token 在响应头里
    return response.headers.get('x-ware-csrf-token') || ''
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    // 设置请求头规则
    await this.setupHeaderRules()

    try {
      logger.info('Starting publish...')

      // 1. 获取 HTML 内容
      const rawHtml = article.html || markdownToHtml(article.markdown)

      // 2. 清理内容
      let content = this.cleanHtml(rawHtml, {
        removeLinks: true,
        removeIframes: true,
        removeSvgImages: true,
        removeTags: ['qqmusic'],
        removeAttrs: ['data-reader-unique-id'],
      })
      // 移除空的 figure 标签
      content = content.replace(/<figure[^>]*>\s*<\/figure>/gi, '')
      // 移除多余的空行
      content = content.replace(/\n{3,}/g, '\n\n')

      // 3. 处理图片
      content = await this.processImages(
        content,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ['pstatp.com', 'toutiao.com', 'byteimg.com'],
          onProgress: options?.onImageProgress,
        }
      )
      // 将图片包装成头条格式: <div class="pgc-img"><img ...><p class="pgc-img-caption"></p></div>
      content = content.replace(
        /<img\s+([^>]+)>/gi,
        '<div class="pgc-img"><img $1><p class="pgc-img-caption"></p></div>'
      )

      // 4. 处理封面 (暂时禁用以排查问题)
      // TODO: 后续需要重新启用封面上传
      // let coverInfo: ImageUploadResult | null = null
      // if (article.cover) {
      //   try {
      //     coverInfo = await this.uploadImageByUrl(article.cover)
      //   } catch (e) {
      //     console.warn('[Toutiao] Failed to upload cover:', e)
      //   }
      // }

      // 5. 构建封面 JSON (暂时禁用封面以排查问题)
      const pgcFeedCovers = '[]'

      // 6. 构建请求参数
      const extra = JSON.stringify({
        content_source: 100000000402,
        content_word_cnt: content.length,
        is_multi_title: 0,
        sub_titles: [],
        gd_ext: {
          entrance: '',
          from_page: 'publisher_mp',
          enter_from: 'PC',
          device_platform: 'mp',
          is_message: 0,
        },
      })

      const titleId = `${Date.now()}_${Math.random().toString().slice(2, 18)}`

      // 7. 构建表单数据
      const formData = new URLSearchParams()
      formData.append('pgc_id', '0')
      formData.append('source', '29')
      formData.append('extra', extra)
      formData.append('content', content)
      formData.append('title', article.title)
      formData.append('search_creation_info', JSON.stringify({ searchTopOne: 0, abstract: '', clue_id: '' }))
      formData.append('title_id', titleId)
      formData.append('mp_editor_stat', '{}')
      formData.append('is_refute_rumor', '0')
      formData.append('save', '0')
      formData.append('timer_status', '0')
      formData.append('timer_time', '')
      formData.append('educluecard', '')
      formData.append('draft_form_data', JSON.stringify({ coverType: 3 }))
      formData.append('pgc_feed_covers', pgcFeedCovers)
      formData.append('article_ad_type', '3')
      formData.append('is_fans_article', '0')
      formData.append('govern_forward', '0')
      formData.append('praise', '0')
      formData.append('disable_praise', '0')
      formData.append('tree_plan_article', '0')
      formData.append('activity_tag', '0')
      formData.append('trends_writing_tag', '0')
      formData.append('claim_exclusive', '0')

      // 8. 通过 content script 使用页面 fetch 发布（自动注入 msToken/a_bogus）
      const res = await this.publishViaContentScript(
        'https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article&aid=1231',
        formData.toString()
      )

      logger.debug('publish response:', res)

      if (res.err_no !== 0 || !res.data?.pgc_id) {
        throw new Error(res.message || '发布失败')
      }

      const draftId = res.data.pgc_id
      const draftUrl = `https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=${draftId}`

      const result = this.createResult(true, {
        postId: draftId,
        postUrl: draftUrl,
        draftOnly: options?.draftOnly ?? true,
      })

      // 清除请求头规则
      await this.clearHeaderRules()
      return result
    } catch (error) {
      // 清除请求头规则
      await this.clearHeaderRules()
      return this.createResult(false, {
        error: (error as Error).message,
      })
    }
  }

  /**
   * 确保头条 tab 存在，如果不存在则自动创建
   */
  private async ensureToutiaoTab(): Promise<number> {
    if (!this.runtime.tabs) {
      throw new Error('头条发布需要浏览器 tabs API 支持')
    }

    // 查找已存在的头条页面 tab
    const tabs = await this.runtime.tabs.query('https://mp.toutiao.com/*')

    if (tabs.length > 0 && tabs[0].id) {
      return tabs[0].id
    }

    // 没有则创建新 tab
    logger.info('No existing tab found, creating new one...')
    const tab = await this.runtime.tabs.create(
      'https://mp.toutiao.com/profile_v4/graphic/publish',
      false // 后台打开
    )

    // 等待页面加载完成
    await this.runtime.tabs.waitForLoad(tab.id, 30000)

    logger.info('New tab created and loaded:', tab.id)
    return tab.id
  }

  /**
   * 通过 runtime.tabs.executeScript 在页面上下文执行 fetch
   * 页面会自动注入 msToken/a_bogus 等反爬参数
   */
  private async publishViaContentScript(url: string, body: string): Promise<{
    err_no?: number
    data?: { pgc_id: string }
    message?: string
  }> {
    if (!this.runtime.tabs) {
      throw new Error('头条发布需要浏览器 tabs API 支持')
    }

    // 确保有头条 tab
    const tabId = await this.ensureToutiaoTab()
    logger.debug('Using tab:', tabId, 'to execute fetch in MAIN world')

    // 在页面上下文 (MAIN world) 执行 fetch
    const result = await this.runtime.tabs.executeScript<
      { success: boolean; data?: unknown; error?: string },
      [string, string]
    >(
      tabId,
      async (fetchUrl: string, fetchBody: string) => {
        try {
          const response = await fetch(fetchUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: fetchBody,
            credentials: 'include',
          })
          const data = await response.json()
          return { success: true, data }
        } catch (error) {
          return { success: false, error: (error as Error).message }
        }
      },
      [url, body]
    )

    if (!result || !result.success) {
      throw new Error(result?.error || '发布请求失败')
    }

    return result.data as { err_no?: number; data?: { pgc_id: string }; message?: string }
  }

  /**
   * 通过 URL 上传图片
   * 新接口需要先下载图片再上传
   */
  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    // 1. 下载图片
    const imageResponse = await fetch(src)
    if (!imageResponse.ok) {
      throw new Error('图片下载失败: ' + src)
    }
    const imageBlob = await imageResponse.blob()

    // 2. 获取 csrf token
    const csrfToken = await this.getCsrfToken()

    // 3. 上传到新接口
    const formData = new FormData()
    formData.append('image', imageBlob, 'image.jpg')

    const uploadUrl = 'https://mp.toutiao.com/spice/image?upload_source=20020002&aid=1231&device_platform=web'
    const uploadResponse = await this.runtime.fetch(uploadUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-secsdk-csrf-token': csrfToken,
      },
      body: formData,
    })

    const text = await uploadResponse.text()
    let res: {
      code?: number
      data?: {
        image_uri?: string
        image_url?: string
        image_width?: number
        image_height?: number
      }
      message?: string
    }

    try {
      res = JSON.parse(text)
    } catch {
      throw new Error('图片上传响应解析失败')
    }

    logger.debug('Image upload response:', res)

    if (res.code !== 0 || !res.data) {
      throw new Error(res.message || '图片上传失败')
    }

    // 验证返回的 URL 不为空
    if (!res.data.image_url || !res.data.image_uri) {
      logger.error('Upload response missing URL:', res)
      throw new Error('图片上传返回数据不完整')
    }

    return {
      url: res.data.image_url,
      attrs: {
        'class': '',
        'ic-uri': '',
        'image_type': 'image/png',
        'mime_type': '',
        'web_uri': res.data.image_uri,
        'img_width': String(res.data.image_width || 0),
        'img_height': String(res.data.image_height || 0),
      },
    }
  }
}
