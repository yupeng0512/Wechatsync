/**
 * 简单 Markdown 解析器
 * 不使用外部依赖，避免 Chrome Extension CSP 限制
 */

import type { MdastRoot, MdastContent } from './types'

/**
 * 解析 Markdown 为简化的 AST
 * 支持：heading, paragraph, list, blockquote, code block, image, thematicBreak
 */
export function parseMarkdown(markdown: string): MdastRoot {
  const lines = markdown.split('\n')
  const children: MdastContent[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 空行跳过
    if (line.trim() === '') {
      i++
      continue
    }

    // 代码块 ```
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // 跳过结束的 ```
      children.push({
        type: 'code',
        lang: lang || undefined,
        value: codeLines.join('\n'),
      })
      continue
    }

    // 标题 # ## ### etc
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      children.push({
        type: 'heading',
        depth: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(headingMatch[2]),
      })
      i++
      continue
    }

    // 分割线 --- or *** or ___
    if (/^[-*_]{3,}\s*$/.test(line)) {
      children.push({ type: 'thematicBreak' })
      i++
      continue
    }

    // 引用块 >
    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && (lines[i].startsWith('>') || (lines[i].trim() !== '' && quoteLines.length > 0 && !lines[i].match(/^[#\-*\d]/)))) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      children.push({
        type: 'blockquote',
        children: parseMarkdown(quoteLines.join('\n')).children as MdastContent[],
      })
      continue
    }

    // 无序列表 - or * or +
    if (/^[\-*+]\s+/.test(line)) {
      const listItems: MdastContent[] = []
      while (i < lines.length && /^[\-*+]\s+/.test(lines[i])) {
        const itemContent = lines[i].replace(/^[\-*+]\s+/, '')
        listItems.push({
          type: 'listItem',
          children: [{ type: 'paragraph', children: parseInline(itemContent) }],
        })
        i++
      }
      children.push({
        type: 'list',
        ordered: false,
        children: listItems,
      })
      continue
    }

    // 有序列表 1. 2. etc
    if (/^\d+\.\s+/.test(line)) {
      const listItems: MdastContent[] = []
      const startMatch = line.match(/^(\d+)\.\s+/)
      const start = startMatch ? parseInt(startMatch[1], 10) : 1
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const itemContent = lines[i].replace(/^\d+\.\s+/, '')
        listItems.push({
          type: 'listItem',
          children: [{ type: 'paragraph', children: parseInline(itemContent) }],
        })
        i++
      }
      children.push({
        type: 'list',
        ordered: true,
        start,
        children: listItems,
      })
      continue
    }

    // 表格 |
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableRows: MdastContent[] = []
      while (i < lines.length && lines[i].includes('|')) {
        const rowLine = lines[i].trim()
        // 跳过分隔行 |---|---|
        if (/^\|[\s\-:|]+\|$/.test(rowLine)) {
          i++
          continue
        }
        const cells = rowLine
          .split('|')
          .slice(1, -1) // 移除首尾空元素
          .map(cell => cell.trim())

        tableRows.push({
          type: 'tableRow',
          children: cells.map(cell => ({
            type: 'tableCell',
            children: parseInline(cell),
          })),
        })
        i++
      }
      if (tableRows.length > 0) {
        children.push({
          type: 'table',
          children: tableRows,
        })
      }
      continue
    }

    // 普通段落
    const paragraphLines: string[] = []
    while (i < lines.length &&
           lines[i].trim() !== '' &&
           !lines[i].startsWith('#') &&
           !lines[i].startsWith('>') &&
           !lines[i].startsWith('```') &&
           !/^[-*+]\s+/.test(lines[i]) &&
           !/^\d+\.\s+/.test(lines[i]) &&
           !/^[-*_]{3,}\s*$/.test(lines[i]) &&
           !(lines[i].includes('|') && lines[i].trim().startsWith('|'))) {
      paragraphLines.push(lines[i])
      i++
    }

    if (paragraphLines.length > 0) {
      children.push({
        type: 'paragraph',
        children: parseInline(paragraphLines.join('\n')),
      })
    }
  }

  return { type: 'root', children }
}

/**
 * 解析行内元素
 */
function parseInline(text: string): MdastContent[] {
  const result: MdastContent[] = []
  let remaining = text

  while (remaining.length > 0) {
    // 图片 ![alt](url)
    const imgMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/)
    if (imgMatch) {
      result.push({
        type: 'image',
        alt: imgMatch[1],
        url: imgMatch[2],
      })
      remaining = remaining.slice(imgMatch[0].length)
      continue
    }

    // 链接 [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      result.push({
        type: 'link',
        url: linkMatch[2],
        children: [{ type: 'text', value: linkMatch[1] }],
      })
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    // 粗体 **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)([^*_]+)\1/)
    if (boldMatch) {
      result.push({
        type: 'strong',
        children: [{ type: 'text', value: boldMatch[2] }],
      })
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // 斜体 *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)([^*_]+)\1/)
    if (italicMatch) {
      result.push({
        type: 'emphasis',
        children: [{ type: 'text', value: italicMatch[2] }],
      })
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    // 删除线 ~~text~~
    const strikeMatch = remaining.match(/^~~([^~]+)~~/)
    if (strikeMatch) {
      result.push({
        type: 'delete',
        children: [{ type: 'text', value: strikeMatch[1] }],
      })
      remaining = remaining.slice(strikeMatch[0].length)
      continue
    }

    // 行内代码 `code`
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      result.push({
        type: 'inlineCode',
        value: codeMatch[1],
      })
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // 换行 (两个空格 + 换行)
    if (remaining.startsWith('  \n') || remaining.startsWith('\n')) {
      result.push({ type: 'break' })
      remaining = remaining.replace(/^(\s*\n|\n)/, '')
      continue
    }

    // 普通文本 - 找到下一个特殊字符
    const nextSpecial = remaining.search(/[!\[*_~`\n]/)
    if (nextSpecial === -1) {
      // 没有更多特殊字符
      result.push({ type: 'text', value: remaining })
      break
    } else if (nextSpecial === 0) {
      // 特殊字符在开头但没有匹配到模式，当作普通文本
      result.push({ type: 'text', value: remaining[0] })
      remaining = remaining.slice(1)
    } else {
      // 提取普通文本
      result.push({ type: 'text', value: remaining.slice(0, nextSpecial) })
      remaining = remaining.slice(nextSpecial)
    }
  }

  return result
}

/**
 * 提取 Markdown 中的所有图片
 */
export function extractImages(markdown: string): Array<{ src: string; alt: string; index: number }> {
  const images: Array<{ src: string; alt: string; index: number }> = []
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  let index = 0

  while ((match = imgRegex.exec(markdown)) !== null) {
    images.push({
      alt: match[1] || '',
      src: match[2],
      index: index++,
    })
  }

  return images
}
