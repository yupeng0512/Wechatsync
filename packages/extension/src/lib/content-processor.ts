/**
 * 内容预处理模块 (Content Script 环境，有 DOM)
 *
 * 架构说明:
 * 1. 用户选择 N 个平台
 * 2. 读取每个平台的预处理配置
 * 3. Content Script 为每个平台分别预处理
 * 4. 每个平台收到自己定制的 html/markdown
 * 5. Service Worker 只做图片上传 + 调用 API
 */

import { htmlToMarkdownNative, type PreprocessConfig } from '@wechatsync/core'
import { createLogger } from './logger'

const logger = createLogger('ContentProcessor')

// 注意：htmlToMarkdownNative 需要 DOM 环境，只能在 Content Script 中使用

// Re-export PreprocessConfig for backward compatibility
export type { PreprocessConfig }

/**
 * 预处理结果
 */
export interface PreprocessResult {
  html: string
  markdown: string
}

/**
 * 为单个平台预处理内容
 * @param rawHtml 原始 HTML
 * @param config 平台的预处理配置
 * @returns 处理后的 html 和 markdown
 */
export function preprocessForPlatform(rawHtml: string, config: PreprocessConfig): PreprocessResult {
  // 创建临时 DOM 容器
  const container = document.createElement('div')
  container.innerHTML = rawHtml

  // 按配置执行预处理
  if (config.removeComments) {
    removeComments(container)
  }

  if (config.removeIframes) {
    removeElements(container, ['iframe'])
  }

  if (config.removeSpecialTags) {
    if (config.removeSpecialTagsWithParent) {
      // 知乎等平台：移除特殊标签的父元素
      removeElementsWithParent(container, ['mpprofile', 'qqmusic'])
      // 其他特殊标签只移除自身
      removeElements(container, [
        'mpvoice', 'mpcps', 'mp-miniprogram', 'mp-common-product',
      ])
    } else {
      removeElements(container, [
        'mpprofile', 'qqmusic', 'mpvoice', 'mpcps',
        'mp-miniprogram', 'mp-common-product',
      ])
    }
  }

  if (config.removeSvgImages) {
    processSvgImages(container)
  }

  // 移除 script 和 style（总是执行）
  removeElements(container, ['script', 'style', 'noscript'])

  if (config.removeLinks) {
    processLinks(container, config.keepLinkDomains)
  }

  if (config.processLazyImages) {
    processLazyImages(container)
  }

  if (config.processCodeBlocks) {
    processCodeBlocks(container)
  }

  if (config.removeEmptyElements) {
    removeEmptyElements(container)
  }

  if (config.removeDataAttributes) {
    removeDataAttributes(container)
  }

  if (config.removeSrcset || config.removeSizes) {
    removeImageAttributes(container, config)
  }

  if (config.convertSectionToDiv) {
    convertSections(container, 'div')
  } else if (config.convertSectionToP) {
    convertSections(container, 'p')
  }

  // 知乎等平台需要的额外处理
  if (config.removeTrailingBr) {
    removeTrailingBr(container)
  }

  if (config.unwrapNestedFigures) {
    unwrapNestedFigures(container)
  }

  if (config.unwrapSingleChildContainers) {
    unwrapSingleChildContainers(container)
  }

  if (config.compactHtml) {
    compactHtml(container)
  }

  // 清理空内容
  if (config.removeEmptyLines) {
    removeEmptyLines(container)
  }

  if (config.removeEmptyDivs) {
    removeEmptyDivs(container)
  }

  if (config.removeNestedEmptyContainers) {
    removeNestedEmptyContainers(container)
  }

  // 获取处理后的 HTML
  const html = container.innerHTML

  // 总是生成 markdown，确保需要 markdown 的适配器能获取到内容
  const markdown = htmlToMarkdownNative(html)

  return { html, markdown }
}

/**
 * 为多个平台预处理内容
 * @param rawHtml 原始 HTML
 * @param configs 各平台的预处理配置 { platformId: config }
 * @returns 各平台的预处理结果 { platformId: { html, markdown } }
 */
export function preprocessForMultiplePlatforms(
  rawHtml: string,
  configs: Record<string, PreprocessConfig>
): Record<string, PreprocessResult> {
  const results: Record<string, PreprocessResult> = {}

  for (const [platformId, config] of Object.entries(configs)) {
    results[platformId] = preprocessForPlatform(rawHtml, config)
  }

  return results
}

// ============ 预处理函数 ============

/**
 * 移除 HTML 注释
 */
function removeComments(container: HTMLElement): void {
  const iterator = document.createNodeIterator(
    container,
    NodeFilter.SHOW_COMMENT,
    null
  )
  const comments: Comment[] = []
  let node: Comment | null
  while ((node = iterator.nextNode() as Comment | null)) {
    comments.push(node)
  }
  comments.forEach((comment) => comment.remove())
}

/**
 * 移除匹配选择器的元素
 */
function removeElements(container: HTMLElement, selectors: string[]): void {
  const selector = selectors.join(', ')
  container.querySelectorAll(selector).forEach((el) => el.remove())
}

/**
 * 移除匹配选择器的元素及其父元素
 * 用于处理 mpprofile, qqmusic 等微信特殊标签
 */
function removeElementsWithParent(container: HTMLElement, selectors: string[]): void {
  const selector = selectors.join(', ')
  container.querySelectorAll(selector).forEach((el) => {
    // 移除父元素（如果存在且不是 container 本身）
    const parent = el.parentElement
    if (parent && parent !== container) {
      parent.remove()
    } else {
      el.remove()
    }
  })
}

/**
 * 处理 SVG 占位图片
 */
function processSvgImages(container: HTMLElement): void {
  const svgImages = container.querySelectorAll('img[src^="data:image/svg"]')
  svgImages.forEach((img) => {
    const dataSrc = img.getAttribute('data-src')
    if (dataSrc) {
      img.setAttribute('src', dataSrc)
    } else {
      img.remove()
    }
  })
}

/**
 * 处理链接
 */
function processLinks(container: HTMLElement, keepDomains?: string[]): void {
  const links = container.querySelectorAll('a')

  links.forEach((link) => {
    const href = link.getAttribute('href')

    if (href && keepDomains?.length) {
      const shouldKeep = keepDomains.some(domain => href.includes(domain))
      if (shouldKeep) return
    }

    // 用 span 替换 a 标签
    const span = document.createElement('span')
    span.innerHTML = link.innerHTML
    link.parentNode?.replaceChild(span, link)
  })
}

/**
 * 处理懒加载图片
 */
function processLazyImages(container: HTMLElement): void {
  const imgs = container.querySelectorAll('img')
  const lazySrcAttrs = ['data-src', 'data-original', 'data-actualsrc', '_src']

  imgs.forEach((img) => {
    for (const attr of lazySrcAttrs) {
      const lazySrc = img.getAttribute(attr)
      if (lazySrc && !lazySrc.startsWith('data:image/svg')) {
        if (!img.src || img.src.startsWith('data:image/svg')) {
          img.src = lazySrc
        }
        break
      }
    }
    lazySrcAttrs.forEach(attr => img.removeAttribute(attr))
  })
}

/**
 * 检测元素是否是行号容器（包含连续数字 1, 2, 3...）
 */
function isLineNumberContainer(el: Element, codeLineCount: number): boolean {
  // 检查 ul/ol 的 li 子元素
  if (el.tagName === 'UL' || el.tagName === 'OL') {
    const items = el.querySelectorAll('li')
    // 情况1: li 数量与代码行数匹配（空 li，用 CSS 生成行号）
    if (items.length >= 2 && items.length === codeLineCount) {
      const allEmpty = Array.from(items).every(li => !li.textContent?.trim())
      if (allEmpty) return true
    }
    // 情况2: li 包含连续数字 1, 2, 3...
    if (items.length >= 2) {
      let isSequential = true
      items.forEach((li, i) => {
        const num = parseInt(li.textContent?.trim() || '', 10)
        if (num !== i + 1) isSequential = false
      })
      if (isSequential) return true
    }
  }

  // 检查元素内容是否是换行分隔的连续数字
  const text = el.textContent?.trim() || ''
  const lines = text.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean)
  if (lines.length >= 2) {
    const allSequential = lines.every((line, i) => parseInt(line, 10) === i + 1)
    if (allSequential) return true
  }

  return false
}

/**
 * 移除 pre 元素相关的行号容器
 * 使用结构检测而非硬编码 class 名
 */
function removeLineNumberSiblings(pre: Element): void {
  const parent = pre.parentElement
  if (!parent) return

  // 计算代码行数（code 元素数量或文本行数）
  const codeElements = pre.querySelectorAll('code')
  const codeLineCount = codeElements.length > 1
    ? codeElements.length
    : (pre.textContent?.split('\n').length || 0)

  // 检查同级兄弟元素
  Array.from(parent.children).forEach(sibling => {
    if (sibling !== pre && isLineNumberContainer(sibling, codeLineCount)) {
      sibling.remove()
    }
  })
}

/**
 * 处理代码块
 * 使用 DOM 的 innerText 自动解码 HTML 实体
 * 处理微信等平台将每行代码放在单独标签的情况
 */
function processCodeBlocks(container: HTMLElement): void {
  // 1. 先用特定选择器移除已知的行号元素
  removeElements(container, [
    'ul.code-snippet__line-index',
    '.code-snippet__line-index',
    '.line-numbers-rows',  // Prism.js
    '.hljs-ln-numbers',    // highlight.js
    '.gutter',             // 通用
  ])

  // 简化 pre 标签
  const pres = container.querySelectorAll('pre')

  pres.forEach((pre) => {
    try {
      // 2. 再用结构检测移除未知的行号元素（通用方案）
      removeLineNumberSiblings(pre)

      const codeElements = pre.querySelectorAll('code')
      let newHtml: string

      if (codeElements.length > 1) {
        // 多个 code 标签 - 每个 code 是一行（微信代码块格式）
        // 注意：这里故意不包装 <code>，因为内容已从多个 <code> 合并
        const lines: string[] = []
        codeElements.forEach((code) => {
          const text = code.textContent || ''
          lines.push(escapeHtml(text))
        })
        newHtml = lines.join('\n')
      } else if (codeElements.length === 1) {
        // 单个 code 标签 - 使用 innerText 获取文本（保留换行）
        const code = codeElements[0] as HTMLElement
        const text = code.innerText || code.textContent || ''
        newHtml = `<code>${escapeHtml(text)}</code>`
      } else {
        // 无 code 标签 - 使用 pre 的 innerText
        const text = pre.innerText || pre.textContent || ''
        newHtml = `<code>${escapeHtml(text)}</code>`
      }

      // 清理：移除开头结尾空行
      newHtml = newHtml
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')

      // 空代码块跳过
      if (!newHtml.trim()) {
        pre.remove()
        return
      }

      pre.innerHTML = newHtml
      pre.removeAttribute('class')
      pre.removeAttribute('style')
      pre.removeAttribute('data-lang')
    } catch (e) {
      logger.error('processCodeBlocks error:', e)
    }
  })
}

/**
 * 移除空元素
 */
function removeEmptyElements(container: HTMLElement): void {
  for (let i = 0; i < 3; i++) {
    const emptyElements = container.querySelectorAll('p, div, section, span, figure')
    let removed = 0

    emptyElements.forEach((el) => {
      const hasText = el.textContent?.trim()
      const hasMedia = el.querySelector('img, video, audio, iframe, canvas, svg')

      if (!hasText && !hasMedia) {
        el.remove()
        removed++
      }
    })

    if (removed === 0) break
  }
}

/**
 * 移除 data-* 属性
 */
function removeDataAttributes(container: HTMLElement): void {
  const allElements = container.querySelectorAll('*')

  allElements.forEach((el) => {
    const attrs = Array.from(el.attributes)
    attrs.forEach((attr) => {
      if (attr.name.startsWith('data-') && attr.name !== 'data-src') {
        el.removeAttribute(attr.name)
      }
    })
  })
}

/**
 * 移除图片的 srcset/sizes 属性
 */
function removeImageAttributes(container: HTMLElement, config: PreprocessConfig): void {
  const images = container.querySelectorAll('img')
  images.forEach((img) => {
    if (config.removeSrcset) img.removeAttribute('srcset')
    if (config.removeSizes) img.removeAttribute('sizes')
    img.removeAttribute('loading')
    img.removeAttribute('decoding')
  })
}

/**
 * 转换 section 标签
 */
function convertSections(container: HTMLElement, targetTag: 'div' | 'p'): void {
  const sections = container.querySelectorAll('section')
  sections.forEach((section) => {
    const newEl = document.createElement(targetTag)
    newEl.innerHTML = section.innerHTML
    // 复制属性
    Array.from(section.attributes).forEach((attr) => {
      newEl.setAttribute(attr.name, attr.value)
    })
    section.parentNode?.replaceChild(newEl, section)
  })
}

/**
 * 移除段落尾部的 <br> 标签
 */
function removeTrailingBr(container: HTMLElement): void {
  // 查找所有 p, div, section 元素
  const elements = container.querySelectorAll('p, div, section')
  elements.forEach((el) => {
    // 移除末尾的 br 标签
    while (el.lastElementChild?.tagName === 'BR') {
      el.lastElementChild.remove()
    }
  })
}

/**
 * 解包嵌套的 figure 标签
 * <figure><figure><img></figure></figure> → <figure><img></figure>
 */
function unwrapNestedFigures(container: HTMLElement): void {
  // 多次迭代处理多层嵌套
  for (let i = 0; i < 5; i++) {
    const nestedFigures = container.querySelectorAll('figure > figure')
    if (nestedFigures.length === 0) break

    nestedFigures.forEach((innerFigure) => {
      const outerFigure = innerFigure.parentElement
      if (outerFigure?.tagName === 'FIGURE') {
        // 用内层 figure 替换外层
        outerFigure.parentNode?.replaceChild(innerFigure, outerFigure)
      }
    })
  }
}

/**
 * 解包单一子元素容器
 * 移除只包含单个子元素的无意义包装 div
 */
function unwrapSingleChildContainers(container: HTMLElement): void {
  // 多次迭代处理嵌套
  for (let i = 0; i < 5; i++) {
    let unwrapped = 0

    // 查找只有单个子元素的 div
    const divs = container.querySelectorAll('div')
    divs.forEach((div) => {
      // 检查是否只有单个元素子节点（忽略空白文本节点）
      const children = Array.from(div.childNodes).filter(
        (node) => node.nodeType === Node.ELEMENT_NODE ||
          (node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
      )

      if (children.length === 1 && children[0].nodeType === Node.ELEMENT_NODE) {
        const child = children[0] as HTMLElement
        // 只解包特定标签
        if (['DIV', 'ARTICLE', 'P', 'SECTION'].includes(child.tagName)) {
          div.parentNode?.replaceChild(child, div)
          unwrapped++
        }
      }
    })

    if (unwrapped === 0) break
  }
}

/**
 * 压缩 HTML（移除标签间的空白）
 * 适用于 Draft.js 等编辑器
 */
function compactHtml(container: HTMLElement): void {
  // 递归处理文本节点，移除标签间的空白
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  )

  const nodesToRemove: Text[] = []
  let node: Text | null

  while ((node = walker.nextNode() as Text | null)) {
    // 如果文本节点只包含空白，且前后都是元素节点，则标记为移除
    if (node.textContent && /^\s+$/.test(node.textContent)) {
      const prev = node.previousSibling
      const next = node.nextSibling
      const parent = node.parentNode

      // 在块级元素之间的空白可以移除
      if (parent && parent.nodeName !== 'PRE' && parent.nodeName !== 'CODE') {
        if ((!prev || prev.nodeType === Node.ELEMENT_NODE) &&
            (!next || next.nodeType === Node.ELEMENT_NODE)) {
          nodesToRemove.push(node)
        }
      }
    }
  }

  nodesToRemove.forEach((n) => n.remove())
}

/**
 * 移除空行（只含 br 或空白的段落）
 */
function removeEmptyLines(container: HTMLElement): void {
  const elements = container.querySelectorAll('p, section')
  elements.forEach((el) => {
    // 检查是否只包含空白或 br
    const hasOnlyBrOrWhitespace = Array.from(el.childNodes).every((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return !node.textContent?.trim()
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        return (node as Element).tagName === 'BR'
      }
      return true
    })

    if (hasOnlyBrOrWhitespace) {
      el.remove()
    }
  })
}

/**
 * 移除空 div（只含 br 或空白，但保留含图片的）
 */
function removeEmptyDivs(container: HTMLElement): void {
  const divs = container.querySelectorAll('div')
  divs.forEach((div) => {
    // 如果包含图片/视频等媒体元素，保留
    if (div.querySelector('img, video, audio, canvas, svg, iframe')) {
      return
    }

    // 检查是否只包含空白或 br
    const hasOnlyBrOrWhitespace = Array.from(div.childNodes).every((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return !node.textContent?.trim()
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        return (node as Element).tagName === 'BR'
      }
      return true
    })

    if (hasOnlyBrOrWhitespace) {
      div.remove()
    }
  })
}

/**
 * 移除嵌套的空容器
 */
function removeNestedEmptyContainers(container: HTMLElement): void {
  // 多次迭代处理嵌套
  for (let i = 0; i < 5; i++) {
    let removed = 0

    const elements = container.querySelectorAll('div, section, article, span')
    elements.forEach((el) => {
      // 如果包含媒体元素，保留
      if (el.querySelector('img, video, audio, canvas, svg, iframe')) {
        return
      }

      // 检查是否为空或只包含空白
      const text = el.textContent?.trim() || ''
      const hasChildren = el.children.length > 0

      // 完全空的容器
      if (!text && !hasChildren) {
        el.remove()
        removed++
        return
      }

      // 只包含 br 的容器
      if (!text && hasChildren) {
        const allBr = Array.from(el.children).every(
          (child) => child.tagName === 'BR'
        )
        if (allBr) {
          el.remove()
          removed++
        }
      }
    })

    if (removed === 0) break
  }
}

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ============ 兼容旧 API ============

/**
 * @deprecated 使用 preprocessForPlatform 代替
 */
export function preprocessContentDOM(container: HTMLElement): void {
  // 执行默认的全部预处理
  removeComments(container)
  removeElements(container, ['iframe', 'script', 'style', 'noscript'])
  removeElements(container, ['mpprofile', 'qqmusic', 'mpvoice', 'mpcps', 'mp-miniprogram', 'mp-common-product'])
  processSvgImages(container)
  processLazyImages(container)
  processCodeBlocks(container)
  removeEmptyElements(container)
  removeDataAttributes(container)
  removeImageAttributes(container, { outputFormat: 'html', removeSrcset: true, removeSizes: true })
}

/**
 * @deprecated 使用 preprocessForPlatform 代替
 */
export function preprocessContentString(html: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html
  preprocessContentDOM(tempDiv)
  return tempDiv.innerHTML
}
