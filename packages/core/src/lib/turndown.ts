/**
 * Turndown HTML→Markdown 转换工具
 *
 * 基于 turndown 库，添加表格和代码块扩展规则
 * 移植自旧版 @wechatsync/drivers/tools/turnDownExtend.js
 *
 * 架构说明:
 * - htmlToMarkdownNative: 使用原生 DOM，适用于 Content Script（推荐）
 * - htmlToMarkdown: 使用正则转换，适用于 Service Worker（回退方案）
 */

import TurndownService from 'turndown'

/**
 * 转换选项
 */
export interface TurndownOptions {
  /** 标题样式: setext (===) 或 atx (#) */
  headingStyle?: 'setext' | 'atx'
  /** 水平线样式 */
  hr?: string
  /** 粗体分隔符 */
  bulletListMarker?: '-' | '+' | '*'
  /** 代码块样式 */
  codeBlockStyle?: 'indented' | 'fenced'
  /** 代码块围栏符号 */
  fence?: '```' | '~~~'
  /** 强调分隔符 */
  emDelimiter?: '_' | '*'
  /** 粗体分隔符 */
  strongDelimiter?: '__' | '**'
  /** 链接样式 */
  linkStyle?: 'inlined' | 'referenced'
  /** 链接引用样式 */
  linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut'
}

/**
 * 表格单元格处理
 */
function cell(content: string, node: Element): string {
  // 计算元素在兄弟元素中的位置
  // 使用 querySelectorAll 获取所有同级 th/td（更可靠）
  const parent = node.parentNode as Element | null
  if (!parent) {
    return '| ' + content + ' |'
  }
  const siblings = parent.querySelectorAll('th, td')
  const index = Array.from(siblings).indexOf(node)
  const prefix = index === 0 ? '| ' : ' '
  return prefix + content + ' |'
}

/**
 * 获取表格的第一行（兼容 linkedom，不依赖 table.rows）
 */
function getFirstRow(table: Element): Element | null {
  // linkedom 没有 table.rows，直接查询 tr
  const tr = table.querySelector('tr')
  return tr
}

/**
 * 判断是否为表头行
 */
function isHeadingRow(tr: Element): boolean {
  const parentNode = tr.parentNode as Element | null
  if (!parentNode) return false

  // 获取所有元素子节点（th/td），排除文本节点
  // 使用 querySelectorAll 更可靠（兼容 linkedom）
  const cells = tr.querySelectorAll('th, td')

  return (
    parentNode.nodeName === 'THEAD' ||
    (
      parentNode.firstChild === tr &&
      (parentNode.nodeName === 'TABLE' || isFirstTbody(parentNode)) &&
      cells.length > 0 &&
      Array.from(cells).every((n: Element) => n.nodeName === 'TH')
    )
  )
}

/**
 * 判断是否为第一个 tbody
 */
function isFirstTbody(element: Element): boolean {
  const previousSibling = element.previousSibling as Element | null

  return (
    element.nodeName === 'TBODY' && (
      !previousSibling ||
      (
        previousSibling.nodeName === 'THEAD' &&
        /^\s*$/i.test(previousSibling.textContent || '')
      )
    )
  )
}

/**
 * 添加表格和代码块扩展规则
 */
function addExtensionRules(turndownService: TurndownService): void {
  // figure 元素 - 直接透传内容（常包裹 table）
  turndownService.addRule('figure', {
    filter: 'figure',
    replacement: function(content) {
      return content
    }
  })

  // figcaption 元素 - 转为斜体文本
  turndownService.addRule('figcaption', {
    filter: 'figcaption',
    replacement: function(content) {
      return content ? '\n*' + content.trim() + '*\n' : ''
    }
  })

  // 表格单元格
  turndownService.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: function(content, node) {
      return cell(content, node as Element)
    }
  })

  // 表格行
  turndownService.addRule('tableRow', {
    filter: 'tr',
    replacement: function(content, node) {
      const tr = node as Element
      let borderCells = ''
      const alignMap: Record<string, string> = { left: ':--', right: '--:', center: ':-:' }

      if (isHeadingRow(tr)) {
        // 使用 querySelectorAll 获取所有 th/td（兼容 linkedom）
        const cells = tr.querySelectorAll('th, td')
        cells.forEach((child) => {
          let border = '---'
          const align = (child.getAttribute?.('align') || '').toLowerCase()

          if (align && alignMap[align]) {
            border = alignMap[align]
          }

          borderCells += cell(border, child)
        })
      }
      return '\n' + content + (borderCells ? '\n' + borderCells : '')
    }
  })

  // 表格
  turndownService.addRule('table', {
    filter: function(node) {
      try {
        if (node.nodeName !== 'TABLE') return false
        const table = node as Element
        const firstRow = getFirstRow(table)
        if (!firstRow) return false
        return isHeadingRow(firstRow)
      } catch (err) {
        console.error('[Turndown] Table filter error:', err)
        return false
      }
    },
    replacement: function(content) {
      // 确保没有空行
      content = content.replace(/\n\n/g, '\n')
      return '\n\n' + content + '\n\n'
    }
  })

  // 表格区段
  turndownService.addRule('tableSection', {
    filter: ['thead', 'tbody', 'tfoot'],
    replacement: function(content) {
      return content
    }
  })

  // 代码块
  turndownService.addRule('preCode', {
    filter: ['pre'],
    replacement: function(_content, node) {
      const pre = node as HTMLPreElement
      // 尝试获取语言
      const code = pre.querySelector('code')
      let language = ''
      if (code) {
        const className = code.className || ''
        const langMatch = className.match(/language-(\w+)/)
        if (langMatch) {
          language = langMatch[1]
        }
      }
      const text = pre.textContent || ''
      return '\n```' + language + '\n' + text + '\n```\n'
    }
  })

  // 保留没有表头的表格（作为 HTML）
  turndownService.keep(function(node) {
    try {
      if (node.nodeName !== 'TABLE') return false
      const table = node as Element
      const firstRow = getFirstRow(table)
      if (!firstRow) return true
      return !isHeadingRow(firstRow)
    } catch (err) {
      console.error('[Turndown] Table keep filter error:', err)
      return false
    }
  })
}

/**
 * 创建配置好的 Turndown 实例
 */
export function createTurndownService(options: TurndownOptions = {}): TurndownService {
  const turndownService = new TurndownService({
    headingStyle: options.headingStyle || 'atx',
    hr: options.hr || '---',
    bulletListMarker: options.bulletListMarker || '-',
    codeBlockStyle: options.codeBlockStyle || 'fenced',
    fence: options.fence || '```',
    emDelimiter: options.emDelimiter || '*',
    strongDelimiter: options.strongDelimiter || '**',
    linkStyle: options.linkStyle || 'inlined',
    linkReferenceStyle: options.linkReferenceStyle || 'full',
  })

  // 添加扩展规则
  addExtensionRules(turndownService)

  return turndownService
}

/**
 * HTML 转 Markdown
 * 使用 linkedom 解析 HTML，兼容 Service Worker 环境
 * 如果 turndown 失败，使用简单正则转换作为回退
 */
export function htmlToMarkdown(html: string, _options: TurndownOptions = {}): string {
  // linkedom + turndown has compatibility issues in Service Worker environments
  // Use regex-based conversion instead for reliability
  return htmlToMarkdownSimple(html)
}

/**
 * 从 className 提取编程语言
 */
function extractLangFromClass(className: string): string {
  if (!className) return ''

  const patterns = [
    /language-(\w+)/i,           // language-javascript
    /lang-(\w+)/i,               // lang-js
    /\bhljs\s+(\w+)/i,           // hljs javascript
    /\b(javascript|typescript|python|java|cpp|c|csharp|go|rust|ruby|php|swift|kotlin|scala|sql|html|css|json|xml|yaml|markdown|bash|shell|powershell)\b/i,
  ]

  for (const pattern of patterns) {
    const match = className.match(pattern)
    if (match) {
      return match[1].toLowerCase()
    }
  }

  return ''
}

/**
 * 简单的正则 HTML → Markdown 转换 (回退方案)
 * 增强版：支持表格转换、代码块语言识别、LaTeX 公式
 */
function htmlToMarkdownSimple(html: string): string {
  let md = html

  // 表格转换 - 必须在移除其他标签之前处理
  md = convertTables(md)

  // 标题
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n')
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n')

  // 粗体和斜体
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')

  // 链接
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')

  // 图片
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)')

  // 代码块 - 增强语言检测
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match, content) => {
    let language = ''

    // 从 pre 标签提取语言
    const preLangMatch = match.match(/<pre[^>]*data-lang(?:uage)?=["'](\w+)["']/)
    const preClassMatch = match.match(/<pre[^>]*class="([^"]*)"/)
    if (preLangMatch) {
      language = preLangMatch[1]
    } else if (preClassMatch) {
      language = extractLangFromClass(preClassMatch[1])
    }

    // 从 code 标签提取语言
    const codeLangMatch = content.match(/<code[^>]*data-lang(?:uage)?=["'](\w+)["']/)
    const codeClassMatch = content.match(/<code[^>]*class="([^"]*)"/)
    if (!language) {
      if (codeLangMatch) {
        language = codeLangMatch[1]
      } else if (codeClassMatch) {
        language = extractLangFromClass(codeClassMatch[1])
      }
    }

    // 提取纯文本内容
    let text = content
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '$1')
      .replace(/<[^>]+>/g, '')

    // 解码 HTML 实体
    text = text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")

    return '\n```' + language + '\n' + text.trim() + '\n```\n'
  })

  // 行内代码
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')

  // 列表
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '$1\n')
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '$1\n')
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')

  // 段落和换行
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
  md = md.replace(/<br\s*\/?>/gi, '\n')
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n')

  // 块引用
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    return '\n' + content.trim().split('\n').map((line: string) => '> ' + line).join('\n') + '\n'
  })

  // LaTeX 公式 - 块级 (mode=display)
  // 注意：$$ 在替换字符串中需要写成 $$$$ 才能输出 $$
  md = md.replace(/<script[^>]*type=["']math\/tex[^"']*display[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi, '\n$$$$\n$1\n$$$$\n')
  // LaTeX 公式 - 行内
  md = md.replace(/<script[^>]*type=["']math\/tex["'][^>]*>([\s\S]*?)<\/script>/gi, ' $$$$$1$$$$ ')

  // 移除其他标签
  md = md.replace(/<\/?[^>]+(>|$)/g, '')

  // 解码 HTML 实体
  md = md.replace(/&amp;/g, '&')
  md = md.replace(/&lt;/g, '<')
  md = md.replace(/&gt;/g, '>')
  md = md.replace(/&quot;/g, '"')
  md = md.replace(/&#039;/g, "'")
  md = md.replace(/&nbsp;/g, ' ')

  // 清理多余空行
  md = md.replace(/\n{3,}/g, '\n\n')
  md = md.trim()

  return md
}

/**
 * 将 HTML 表格转换为 Markdown 表格
 */
function convertTables(html: string): string {
  // 先处理 figure 包裹的表格
  html = html.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (match, figureContent) => {
    // 检查是否包含表格
    if (/<table[^>]*>/i.test(figureContent)) {
      // 提取表格部分，保留 figcaption
      const tableMatch = figureContent.match(/<table[^>]*>([\s\S]*?)<\/table>/i)
      const captionMatch = figureContent.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)

      if (tableMatch) {
        let result = tableMatch[0] // 返回表格部分
        if (captionMatch) {
          // 添加 caption 作为斜体
          const caption = captionMatch[1].replace(/<[^>]+>/g, '').trim()
          if (caption) {
            result += '\n*' + caption + '*\n'
          }
        }
        return result
      }
    }
    return match // 非表格 figure 保持原样
  })

  // 匹配整个表格
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    // 检查是否有表头（thead 或 第一行全是 th）
    const hasTheadMatch = tableContent.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)
    const rows: string[][] = []
    const alignments: string[][] = [] // 存储每行每个单元格的对齐方式
    let headerRowIndex = -1

    // 提取所有行
    const rowMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || []

    for (let i = 0; i < rowMatches.length; i++) {
      const rowContent = rowMatches[i]
      const cells: string[] = []
      const rowAligns: string[] = []

      // 检查单元格类型（th 或 td）
      const cellMatches = rowContent.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || []
      const isHeaderRow = cellMatches.length > 0 && cellMatches.every((c: string) => c.startsWith('<th'))

      for (const cellMatch of cellMatches) {
        // 提取单元格内容和对齐属性
        const fullMatch = cellMatch.match(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/i)
        if (fullMatch) {
          const attrs = fullMatch[1]
          const rawContent = fullMatch[2]

          // 提取对齐方式
          const alignMatch = attrs.match(/align=["']?(left|center|right)["']?/i) ||
                            attrs.match(/style=["'][^"']*text-align:\s*(left|center|right)/i)
          const align = alignMatch ? alignMatch[1].toLowerCase() : ''
          rowAligns.push(align)

          // 清理内容
          let content = rawContent
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()

          // 转义管道符
          content = content.replace(/\|/g, '\\|')
          cells.push(content)
        }
      }

      if (cells.length > 0) {
        rows.push(cells)
        alignments.push(rowAligns)
        // 记录表头行（在 thead 中或是第一行全 th）
        if (hasTheadMatch && rowContent.indexOf('<th') !== -1) {
          headerRowIndex = i
        } else if (i === 0 && isHeaderRow) {
          headerRowIndex = 0
        }
      }
    }

    // 如果没有行，返回空
    if (rows.length === 0) {
      return ''
    }

    // 如果没有找到表头行，将第一行作为表头（降级处理）
    if (headerRowIndex === -1) {
      headerRowIndex = 0
    }

    // 转换为 Markdown
    const mdRows: string[] = []
    const colCount = Math.max(...rows.map(r => r.length))

    // 获取表头行的对齐信息
    const headerAligns = alignments[headerRowIndex] || []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      // 填充缺失的单元格
      while (row.length < colCount) {
        row.push('')
      }

      mdRows.push('| ' + row.join(' | ') + ' |')

      // 在表头行之后添加分隔行（带对齐信息）
      if (i === headerRowIndex) {
        const separators = []
        for (let j = 0; j < colCount; j++) {
          const align = headerAligns[j] || ''
          if (align === 'left') {
            separators.push(':---')
          } else if (align === 'center') {
            separators.push(':---:')
          } else if (align === 'right') {
            separators.push('---:')
          } else {
            separators.push('---')
          }
        }
        mdRows.push('| ' + separators.join(' | ') + ' |')
      }
    }

    return '\n\n' + mdRows.join('\n') + '\n\n'
  })
}

/**
 * 默认的 Turndown 实例（可复用）
 */
let defaultService: TurndownService | null = null

/**
 * 获取默认 Turndown 实例
 */
export function getDefaultTurndownService(): TurndownService {
  if (!defaultService) {
    defaultService = createTurndownService()
  }
  return defaultService
}

// 导出 TurndownService 类型供外部使用
export { TurndownService }

/**
 * HTML 转 Markdown（使用原生 DOM）
 * 适用于 Content Script / 页面环境，利用浏览器原生 DOM
 * 比 linkedom 兼容性更好，转换质量更高
 */
export function htmlToMarkdownNative(html: string, options: TurndownOptions = {}): string {
  if (typeof document === 'undefined') {
    // 回退到简单正则转换（Service Worker 环境）
    console.warn('[Turndown] No native DOM, falling back to regex conversion')
    return htmlToMarkdownSimple(html)
  }

  try {
    const turndownService = new TurndownService({
      headingStyle: options.headingStyle || 'atx',
      hr: options.hr || '---',
      bulletListMarker: options.bulletListMarker || '-',
      codeBlockStyle: options.codeBlockStyle || 'fenced',
      fence: options.fence || '```',
      emDelimiter: options.emDelimiter || '*',
      strongDelimiter: options.strongDelimiter || '**',
      linkStyle: options.linkStyle || 'inlined',
      linkReferenceStyle: options.linkReferenceStyle || 'full',
    })

    // 添加扩展规则
    addExtensionRules(turndownService)

    // 使用原生 DOM 解析 HTML
    const container = document.createElement('div')
    container.innerHTML = html

    return turndownService.turndown(container)
  } catch (err) {
    console.error('[Turndown] Native DOM conversion failed:', err)
    return htmlToMarkdownSimple(html)
  }
}

// ============ Markdown → HTML ============

import { marked } from 'marked'

/**
 * Markdown 转 HTML
 */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string
}

/**
 * HTML 标准化
 * 通过 HTML → Markdown → HTML 往返转换，清理所有多余结构
 */
export function normalizeHtml(html: string, options: TurndownOptions = {}): string {
  const markdown = htmlToMarkdown(html, options)
  return markdownToHtml(markdown)
}
