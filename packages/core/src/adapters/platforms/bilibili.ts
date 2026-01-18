/**
 * B站适配器
 */
import { CodeAdapter, type ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../../types'
import type { PublishOptions } from '../types'
import { markdownToHtml } from '../../lib'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Bilibili')

interface BilibiliUserInfo {
  mid: number
  uname: string
  face: string
  isLogin: boolean
}

export class BilibiliAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'bilibili',
    name: '哔哩哔哩',
    icon: 'https://www.bilibili.com/favicon.ico',
    homepage: 'https://member.bilibili.com/platform/upload/text',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private userInfo: BilibiliUserInfo | null = null
  private csrf: string = ''
  private headerRuleIds: string[] = []

  /**
   * 设置动态请求头规则 (CORS)
   */
  private async setupHeaderRules(): Promise<void> {
    if (this.headerRuleIds.length > 0) return
    if (!this.runtime.headerRules) return

    // api.bilibili.com
    const ruleId = await this.runtime.headerRules.add({
      urlFilter: '*://api.bilibili.com/*',
      headers: {
        'Origin': 'https://member.bilibili.com',
        'Referer': 'https://member.bilibili.com/',
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
        code: number
        data?: BilibiliUserInfo
      }>('https://api.bilibili.com/x/web-interface/nav?build=0&mobi_app=web')

      logger.debug('checkAuth response:', res)

      if (res.code === 0 && res.data?.isLogin) {
        this.userInfo = res.data
        await this.fetchCsrf()

        return {
          isAuthenticated: true,
          userId: String(res.data.mid),
          username: res.data.uname,
          avatar: res.data.face,
        }
      }

      return { isAuthenticated: false }
    } catch (error) {
      logger.debug('checkAuth: not logged in -', error)
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  private async fetchCsrf(): Promise<void> {
    try {
      if (this.runtime.getCookie) {
        const value = await this.runtime.getCookie('.bilibili.com', 'bili_jct')
        this.csrf = value || ''
      }
      logger.debug('CSRF token:', this.csrf ? 'obtained' : 'not found')
    } catch (e) {
      logger.error('Failed to get CSRF:', e)
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    // 设置请求头规则
    await this.setupHeaderRules()

    try {
      logger.info('Starting publish...')

      if (!this.userInfo) {
        const auth = await this.checkAuth()
        if (!auth.isAuthenticated) {
          throw new Error('请先登录B站')
        }
      }

      if (!this.csrf) {
        throw new Error('获取 CSRF token 失败，请刷新页面后重试')
      }

      const rawHtml = article.html || markdownToHtml(article.markdown)

      let content = this.cleanHtml(rawHtml, {
        removeLinks: true,
        removeIframes: true,
        removeSvgImages: true,
        removeTags: ['qqmusic'],
        removeAttrs: ['data-reader-unique-id'],
      })

      content = await this.processImages(
        content,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ['hdslb.com', 'bilibili.com', 'biliimg.com'],
          onProgress: options?.onImageProgress,
        }
      )

      const res = await this.postForm<{
        code: number
        message?: string
        data?: { aid: number }
      }>(
        'https://api.bilibili.com/x/article/creative/draft/addupdate',
        {
          tid: '4',
          title: article.title,
          content: content,
          csrf: this.csrf,
          save: '0',
          pgc_id: '0',
        }
      )

      logger.debug('Draft response:', res)

      if (res.code !== 0 || !res.data?.aid) {
        throw new Error(res.message || '保存草稿失败')
      }

      const draftUrl = `https://member.bilibili.com/platform/upload/text/edit?aid=${res.data.aid}`

      const result = this.createResult(true, {
        postId: String(res.data.aid),
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

  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    if (!this.csrf) {
      throw new Error('CSRF token 未获取')
    }

    const imageResponse = await fetch(src)
    if (!imageResponse.ok) {
      throw new Error('图片下载失败: ' + src)
    }
    const imageBlob = await imageResponse.blob()

    const formData = new FormData()
    formData.append('binary', imageBlob, 'image.jpg')
    formData.append('csrf', this.csrf)

    const uploadUrl = 'https://api.bilibili.com/x/article/creative/article/upcover'
    const uploadResponse = await this.runtime.fetch(uploadUrl, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })

    const res = await uploadResponse.json() as {
      code: number
      message?: string
      data?: {
        url: string
        size: number
      }
    }

    logger.debug('Image upload response:', res)

    if (res.code !== 0 || !res.data?.url) {
      throw new Error(res.message || '图片上传失败')
    }

    return {
      url: res.data.url,
      attrs: {
        size: String(res.data.size),
      },
    }
  }
}
