/**
 * 文章提取器 Content Script
 * 从当前页面提取文章内容
 *
 * 提取策略:
 * 1. 特定平台提取器 (微信公众号等)
 * 2. Safari ReaderArticleFinder (通用，效果最佳)
 * 3. Mozilla Readability (通用，作为回退)
 * 4. <article> 标签 (最后手段)
 *
 * 内容格式:
 * - 在页面端使用 Turndown + 原生 DOM 将 HTML 转为 Markdown
 * - Service Worker 只需处理 Markdown，无需 DOM 解析
 */

import { extractArticle as extractWithReader, ReaderResult } from '../lib/reader'
import { htmlToMarkdownNative } from '@wechatsync/core'
import { createLogger } from '../lib/logger'

const logger = createLogger('Extractor')

interface ExtractedArticle {
  title: string
  markdown: string   // Markdown 格式（主要）
  html?: string      // 原始 HTML（可选，用于某些平台）
  summary?: string
  cover?: string
  source: {
    url: string
    platform: string
  }
}

/**
 * 提取文章内容
 */
function extractArticle(): ExtractedArticle | null {
  const url = window.location.href

  // 微信公众号
  if (url.includes('mp.weixin.qq.com')) {
    return extractWeixinArticle()
  }

  // 通用提取 (使用 Safari Reader / Readability)
  return extractGenericArticle()
}

/**
 * 提取微信公众号文章
 */
function extractWeixinArticle(): ExtractedArticle | null {
  const title = document.querySelector('#activity-name')?.textContent?.trim()
  const contentEl = document.querySelector('#js_content')
  const cover = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
  const summary = document.querySelector('meta[property="og:description"]')?.getAttribute('content')

  if (!title || !contentEl) {
    return null
  }

  // 克隆内容元素，预处理（图片、代码块等）
  const clonedContent = contentEl.cloneNode(true) as HTMLElement
  preprocessContent(clonedContent)

  // 获取 HTML 并转换为 Markdown
  const html = clonedContent.innerHTML
  const markdown = htmlToMarkdownNative(html)

  return {
    title,
    markdown,
    html, // 保留原始 HTML，微信平台需要
    summary: summary || undefined,
    cover: cover || undefined,
    source: {
      url: window.location.href,
      platform: 'weixin',
    },
  }
}

/**
 * 处理懒加载图片
 * 微信等平台使用懒加载，真实 URL 在 data-src 等属性中
 */
function processLazyImages(container: HTMLElement) {
  const images = container.querySelectorAll('img')

  images.forEach((img) => {
    // 按优先级查找真实图片 URL
    const realSrc =
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-actualsrc') ||
      img.getAttribute('_src') ||
      img.src

    // 跳过 data URL (SVG 占位符等)
    if (realSrc && !realSrc.startsWith('data:image/svg')) {
      img.setAttribute('src', realSrc)
    }

    // 清理懒加载属性
    img.removeAttribute('data-src')
    img.removeAttribute('data-original')
    img.removeAttribute('data-actualsrc')
    img.removeAttribute('_src')
    img.removeAttribute('data-ratio')
    img.removeAttribute('data-w')
    img.removeAttribute('data-type')
    img.removeAttribute('data-s')
  })
}

/**
 * 处理代码块（使用 DOM，等价旧版 processDocCode）
 * 将复杂的代码块转换为简单的 <pre><code>纯文本</code></pre>
 */
function processCodeBlocks(container: HTMLElement) {
  const pres = container.querySelectorAll('pre')

  pres.forEach((pre) => {
    try {
      // 获取纯文本内容（DOM 的 innerText 会正确处理换行）
      const text = pre.innerText || pre.textContent || ''

      // 转义 HTML 特殊字符
      const escapedText = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')

      // 替换内容为简单的 <code> 结构
      pre.innerHTML = `<code>${escapedText}</code>`

      // 清理 pre 上的多余属性
      pre.removeAttribute('class')
      pre.removeAttribute('style')
      pre.removeAttribute('data-lang')
    } catch (e) {
      logger.error('processCodeBlocks error:', e)
    }
  })
}

/**
 * 预处理内容（在提取时统一处理）
 */
function preprocessContent(container: HTMLElement) {
  processLazyImages(container)
  processCodeBlocks(container)
}

/**
 * 通用文章提取
 * 使用 Safari ReaderArticleFinder / Mozilla Readability
 */
function extractGenericArticle(): ExtractedArticle | null {
  // 使用统一的 Reader 提取器
  const result = extractWithReader()

  if (result) {
    return readerResultToArticle(result)
  }

  // 如果 Reader 提取失败，尝试简单的选择器
  return extractWithSelectors()
}

/**
 * 将 ReaderResult 转换为 ExtractedArticle
 */
function readerResultToArticle(result: ReaderResult): ExtractedArticle {
  // 创建临时 DOM 进行预处理
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = result.content
  preprocessContent(tempDiv)
  const processedHtml = tempDiv.innerHTML

  // 转换为 Markdown
  const markdown = htmlToMarkdownNative(processedHtml)

  return {
    title: result.title,
    markdown,
    html: processedHtml, // 预处理后的 HTML
    summary: result.excerpt,
    cover: result.leadingImage || result.mainImage,
    source: {
      url: window.location.href,
      platform: result.extractor,
    },
  }
}

/**
 * 使用 CSS 选择器提取 (最后手段)
 */
function extractWithSelectors(): ExtractedArticle | null {
  // 尝试常见的文章选择器
  const selectors = {
    title: [
      'h1',
      'article h1',
      '.article-title',
      '.post-title',
      '[itemprop="headline"]',
    ],
    content: [
      'article',
      '.article-content',
      '.post-content',
      '.entry-content',
      '[itemprop="articleBody"]',
      'main',
    ],
  }

  let title: string | null = null
  for (const selector of selectors.title) {
    const el = document.querySelector(selector)
    if (el?.textContent?.trim()) {
      title = el.textContent.trim()
      break
    }
  }

  let html: string | null = null
  for (const selector of selectors.content) {
    const el = document.querySelector(selector)
    if (el?.innerHTML) {
      // 克隆并预处理
      const clonedContent = el.cloneNode(true) as HTMLElement
      preprocessContent(clonedContent)
      html = clonedContent.innerHTML
      break
    }
  }

  // 回退到 meta 标签
  if (!title) {
    title = document.querySelector('meta[property="og:title"]')?.getAttribute('content')
      || document.title
  }

  if (!title || !html) {
    return null
  }

  // 转换为 Markdown
  const markdown = htmlToMarkdownNative(html)

  const cover = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
  const summary = document.querySelector('meta[property="og:description"]')?.getAttribute('content')

  return {
    title,
    markdown,
    html, // 保留原始 HTML
    summary: summary || undefined,
    cover: cover || undefined,
    source: {
      url: window.location.href,
      platform: 'selector',
    },
  }
}

// ========== 编辑器注入 ==========

let editorIframe: HTMLIFrameElement | null = null
let editorContainer: HTMLDivElement | null = null

/**
 * 打开编辑器
 */
function openEditor(article: ExtractedArticle, platforms: any[], selectedPlatformIds?: string[]) {
  if (editorContainer) {
    // 已经打开，重新发送数据
    sendDataToEditor(article, platforms, selectedPlatformIds)
    return
  }

  // 创建全屏容器
  editorContainer = document.createElement('div')
  editorContainer.id = 'wechatsync-editor-container'
  editorContainer.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 2147483647 !important;
    background: white !important;
    margin: 0 !important;
    padding: 0 !important;
  `

  // 创建 iframe
  editorIframe = document.createElement('iframe')
  editorIframe.src = chrome.runtime.getURL('src/editor/index.html')
  editorIframe.style.cssText = `
    width: 100vw !important;
    height: 100vh !important;
    border: none !important;
    margin: 0 !important;
    padding: 0 !important;
    display: block !important;
  `

  editorContainer.appendChild(editorIframe)
  document.body.appendChild(editorContainer)

  // 禁止页面滚动
  document.body.style.overflow = 'hidden'

  // 等待 iframe 准备好后发送数据
  const handleEditorReady = (event: MessageEvent) => {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      if (data.type === 'EDITOR_READY') {
        sendDataToEditor(article, platforms, selectedPlatformIds)
        window.removeEventListener('message', handleEditorReady)
      }
    } catch (e) {
      // ignore
    }
  }
  window.addEventListener('message', handleEditorReady)
}

/**
 * 发送数据到编辑器
 */
function sendDataToEditor(article: ExtractedArticle, platforms: any[], selectedPlatformIds?: string[]) {
  if (!editorIframe?.contentWindow) return

  // 发送文章数据
  editorIframe.contentWindow.postMessage(JSON.stringify({
    type: 'ARTICLE_DATA',
    article: {
      title: article.title,
      content: article.html || article.markdown,
      cover: article.cover,
      url: article.source.url,
    },
  }), '*')

  // 发送平台数据（包含已选中的平台）
  editorIframe.contentWindow.postMessage(JSON.stringify({
    type: 'PLATFORMS_DATA',
    platforms,
    selectedPlatformIds, // 传递已选中的平台 ID
  }), '*')
}

/**
 * 关闭编辑器
 */
function closeEditor() {
  if (editorContainer) {
    editorContainer.remove()
    editorContainer = null
    editorIframe = null
    document.body.style.overflow = ''
  }
}

/**
 * 监听编辑器消息
 */
window.addEventListener('message', async (event) => {
  try {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data

    if (data.type === 'CLOSE_EDITOR') {
      closeEditor()
    } else if (data.type === 'START_SYNC') {
      // 转发同步请求到 background
      // 编辑器传来的是 HTML content，需要转换为 markdown
      const htmlContent = data.article.content || ''
      const markdownContent = htmlToMarkdownNative(htmlContent)

      chrome.runtime.sendMessage({
        type: 'START_SYNC_FROM_EDITOR',
        article: {
          ...data.article,
          html: htmlContent,
          markdown: markdownContent,
        },
        platforms: data.platforms,
      })
    }
  } catch (e) {
    // ignore
  }
})

/**
 * 监听 background 消息，转发同步进度到编辑器
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_ARTICLE') {
    const article = extractArticle()
    sendResponse({ article })
  } else if (message.type === 'OPEN_EDITOR') {
    // 打开编辑器
    const article = extractArticle()
    if (article) {
      // 传递平台列表和已选中的平台 ID
      openEditor(article, message.platforms || [], message.selectedPlatforms || [])
      sendResponse({ success: true })
    } else {
      sendResponse({ success: false, error: '无法提取文章内容' })
    }
  } else if (message.type === 'SYNC_PROGRESS') {
    // 转发同步进度到编辑器
    editorIframe?.contentWindow?.postMessage(JSON.stringify({
      type: 'SYNC_PROGRESS',
      result: message.result,
    }), '*')
  } else if (message.type === 'SYNC_DETAIL_PROGRESS') {
    // 转发详细进度到编辑器
    // 兼容两种格式：message.payload (from SYNC_ARTICLE) 或直接展开 (from START_SYNC_FROM_EDITOR)
    const progress = message.payload || {
      platform: message.platform,
      platformName: message.platformName,
      stage: message.stage,
      imageProgress: message.imageProgress,
      result: message.result,
      error: message.error,
    }
    editorIframe?.contentWindow?.postMessage(JSON.stringify({
      type: 'SYNC_DETAIL_PROGRESS',
      progress,
    }), '*')
  } else if (message.type === 'SYNC_COMPLETE') {
    // 同步完成
    editorIframe?.contentWindow?.postMessage(JSON.stringify({
      type: 'SYNC_COMPLETE',
      rateLimitWarning: message.rateLimitWarning,
    }), '*')
  } else if (message.type === 'SYNC_ERROR') {
    // 同步错误
    editorIframe?.contentWindow?.postMessage(JSON.stringify({
      type: 'SYNC_ERROR',
      error: message.error,
    }), '*')
  }
  return true
})
