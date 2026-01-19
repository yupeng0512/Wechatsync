/**
 * mdast → ProseMirror JSON 转换器
 * 支持根据平台能力进行降级处理
 */

import type {
  MdastRoot,
  MdastContent,
  PlatformCapabilities,
  PMNode,
  ImageUploader,
} from '../types'

/**
 * 已上传图片缓存
 */
interface UploadedImage {
  url: string
  width: number
  height: number
  fileId?: string
}

/**
 * 转换上下文
 */
interface TransformContext {
  capabilities: PlatformCapabilities
  uploadImage?: ImageUploader
  uploadedImages: Map<string, UploadedImage>
  imageQueue: Array<{ src: string; alt: string }>
  onImageProgress?: (current: number, total: number) => void
}

/**
 * 将 mdast 转换为 ProseMirror JSON
 */
export async function mdastToProseMirror(
  tree: MdastRoot,
  capabilities: PlatformCapabilities,
  options?: {
    uploadImage?: ImageUploader
    onImageProgress?: (current: number, total: number) => void
  }
): Promise<PMNode> {
  const ctx: TransformContext = {
    capabilities,
    uploadImage: options?.uploadImage,
    uploadedImages: new Map(),
    imageQueue: [],
    onImageProgress: options?.onImageProgress,
  }

  // 1. 收集所有图片
  collectImages(tree, ctx)
  console.log('[XHS] Collected images from AST:', ctx.imageQueue.length, ctx.imageQueue)

  // 2. 上传图片
  if (ctx.uploadImage && ctx.imageQueue.length > 0) {
    let uploaded = 0
    for (const img of ctx.imageQueue) {
      if (ctx.uploadedImages.has(img.src)) continue

      try {
        uploaded++
        ctx.onImageProgress?.(uploaded, ctx.imageQueue.length)

        const result = await ctx.uploadImage(img.src)
        ctx.uploadedImages.set(img.src, {
          url: result.url,
          width: result.width || 800,
          height: result.height || 600,
          fileId: result.fileId,
        })

        // 延迟避免请求过快
        await delay(300)
      } catch (e) {
        console.error('Failed to upload image:', img.src, e)
      }
    }
  }

  // 3. 转换 AST
  let content = transformChildren(tree.children, ctx)

  // 移除开头的空段落（小红书不兼容开头空段落，但结尾可以有）
  while (content.length > 0 && isEmptyParagraph(content[0])) {
    content.shift()
  }

  // 确保至少有一个段落（空段落也需要 content: []）
  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [] })
  }

  // 规范化 JSON 结构（确保 type 在前，小红书编辑器要求）
  content = content.map(normalizeNode)

  // 返回规范化的 doc 节点（type 在 content 前面）
  return {
    type: 'doc',
    content,
  }
}

/**
 * 检查是否为空段落
 */
function isEmptyParagraph(node: PMNode): boolean {
  return node.type === 'paragraph' && (!node.content || node.content.length === 0)
}

/**
 * 规范化节点结构（确保 type 字段在最前面）
 * 小红书 ProseMirror 编辑器对 JSON key 顺序敏感
 */
function normalizeNode(node: PMNode): PMNode {
  const result: PMNode = { type: node.type }

  // 按小红书 ProseMirror 期望的顺序: type → attrs → marks → content → text
  if (node.attrs !== undefined) {
    result.attrs = node.attrs
  }

  if (node.marks !== undefined) {
    result.marks = node.marks.map(mark => {
      const normalizedMark: typeof mark = { type: mark.type }
      if (mark.attrs !== undefined) {
        normalizedMark.attrs = mark.attrs
      }
      return normalizedMark
    })
  }

  if (node.content !== undefined) {
    // 过滤掉空 text 节点
    const filteredContent = node.content
      .filter(child => !(child.type === 'text' && (!child.text || child.text === '')))
      .map(normalizeNode)
    // 只有非空 content 才添加（小红书空段落不需要 content 字段）
    if (filteredContent.length > 0) {
      result.content = filteredContent
    }
  }

  if (node.text !== undefined) {
    result.text = node.text
  }

  return result
}

/**
 * 收集所有图片
 */
function collectImages(node: MdastRoot | MdastContent, ctx: TransformContext): void {
  if ('type' in node && node.type === 'image') {
    const imgNode = node as { url: string; alt?: string }
    ctx.imageQueue.push({ src: imgNode.url, alt: imgNode.alt || '' })
  }

  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectImages(child as MdastContent, ctx)
    }
  }
}

/**
 * 转换子节点数组
 */
function transformChildren(children: MdastContent[], ctx: TransformContext): PMNode[] {
  const result: PMNode[] = []

  for (const child of children) {
    const nodes = transformNode(child, ctx)
    result.push(...nodes)
  }

  return result
}

/**
 * 转换单个节点
 */
function transformNode(node: MdastContent, ctx: TransformContext): PMNode[] {
  const { capabilities } = ctx

  switch (node.type) {
    case 'heading':
      return transformHeading(node, ctx)

    case 'paragraph':
      return transformParagraph(node, ctx)

    case 'blockquote':
      if (!capabilities.supportBlockquote) {
        // 降级：转换为普通段落，添加引用符号
        return transformBlockquoteAsText(node, ctx)
      }
      return transformBlockquote(node, ctx)

    case 'list':
      return transformList(node, ctx)

    case 'listItem':
      return transformListItem(node, ctx)

    case 'table':
      if (!capabilities.supportTable) {
        // 降级：表格转换为文本
        return transformTableAsText(node, ctx)
      }
      return [] // 暂不支持原生表格

    case 'thematicBreak':
      if (!capabilities.supportHorizontalRule) {
        // 降级：跳过分割线
        return []
      }
      return [{ type: 'horizontalRule' }]

    case 'code':
      if (!capabilities.supportCodeBlock) {
        // 降级：代码块转换为普通文本
        return [{
          type: 'paragraph',
          content: [{ type: 'text', text: node.value }],
        }]
      }
      return [{
        type: 'codeBlock',
        attrs: { language: node.lang || '' },
        content: [{ type: 'text', text: node.value }],
      }]

    case 'image':
      if (!capabilities.supportImage) {
        // 降级：图片转换为链接文本
        return [{
          type: 'paragraph',
          content: [{ type: 'text', text: `[图片: ${node.alt || node.url}]` }],
        }]
      }
      return transformImage(node, ctx)

    default:
      return []
  }
}

/**
 * 转换标题
 */
function transformHeading(
  node: Extract<MdastContent, { type: 'heading' }>,
  ctx: TransformContext
): PMNode[] {
  const { capabilities } = ctx
  const level = Math.min(node.depth, capabilities.maxHeadingLevel)

  return [{
    type: 'heading',
    attrs: { level },
    content: transformPhrasingContent(node.children, ctx),
  }]
}

/**
 * 转换段落
 * 注意：如果段落中包含图片，需要把图片提取为独立的块级节点
 */
function transformParagraph(
  node: Extract<MdastContent, { type: 'paragraph' }>,
  ctx: TransformContext
): PMNode[] {
  const result: PMNode[] = []

  // 检查是否有图片
  const hasImages = node.children.some(child => child.type === 'image')

  if (hasImages && ctx.capabilities.supportImage) {
    // 有图片时，分离文本和图片
    let textChildren: MdastContent[] = []

    for (const child of node.children) {
      if (child.type === 'image') {
        // 先输出之前累积的文本作为段落
        if (textChildren.length > 0) {
          const textContent = transformPhrasingContent(textChildren, ctx)
          if (textContent.length > 0) {
            result.push({ type: 'paragraph', content: textContent })
          }
          textChildren = []
        }
        // 输出图片作为独立块
        const imageNodes = transformImage(child as Extract<MdastContent, { type: 'image' }>, ctx)
        result.push(...imageNodes)
      } else {
        textChildren.push(child)
      }
    }

    // 输出剩余的文本
    if (textChildren.length > 0) {
      const textContent = transformPhrasingContent(textChildren, ctx)
      if (textContent.length > 0) {
        result.push({ type: 'paragraph', content: textContent })
      }
    }

    return result.length > 0 ? result : [{ type: 'paragraph' }]
  }

  // 没有图片的普通段落
  const content = transformPhrasingContent(node.children, ctx)

  // 空段落
  if (content.length === 0) {
    return [{ type: 'paragraph' }]
  }

  return [{
    type: 'paragraph',
    content,
  }]
}

/**
 * 转换引用块
 */
function transformBlockquote(
  node: Extract<MdastContent, { type: 'blockquote' }>,
  ctx: TransformContext
): PMNode[] {
  const content = transformChildren(node.children, ctx)

  return [{
    type: 'blockquote',
    content,
  }]
}

/**
 * 引用块降级为文本
 */
function transformBlockquoteAsText(
  node: Extract<MdastContent, { type: 'blockquote' }>,
  ctx: TransformContext
): PMNode[] {
  const result: PMNode[] = []

  for (const child of node.children) {
    if (child.type === 'paragraph') {
      const content = transformPhrasingContent(child.children, ctx)
      // 添加引用符号
      content.unshift({ type: 'text', text: '> ' })
      result.push({ type: 'paragraph', content })
    }
  }

  return result
}

/**
 * 转换列表
 */
function transformList(
  node: Extract<MdastContent, { type: 'list' }>,
  ctx: TransformContext
): PMNode[] {
  const items = transformChildren(node.children, ctx)

  if (node.ordered) {
    return [{
      type: 'orderedList',
      attrs: { start: node.start || 1, type: null },
      content: items,
    }]
  }

  return [{
    type: 'bulletList',
    content: items,
  }]
}

/**
 * 转换列表项
 */
function transformListItem(
  node: Extract<MdastContent, { type: 'listItem' }>,
  ctx: TransformContext
): PMNode[] {
  const { capabilities } = ctx
  const content: PMNode[] = []

  for (const child of node.children) {
    if (child.type === 'paragraph') {
      content.push({
        type: 'paragraph',
        content: transformPhrasingContent(child.children, ctx),
      })
    } else if (child.type === 'list') {
      if (capabilities.supportNestedList) {
        // 支持嵌套列表
        content.push(...transformList(child, ctx))
      } else {
        // 降级：嵌套列表展平
        for (const item of child.children) {
          if (item.type === 'listItem') {
            for (const p of item.children) {
              if (p.type === 'paragraph') {
                content.push({
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: '  • ' },
                    ...transformPhrasingContent(p.children, ctx),
                  ],
                })
              }
            }
          }
        }
      }
    }
  }

  return [{
    type: 'listItem',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  }]
}

/**
 * 表格降级为文本
 */
function transformTableAsText(
  node: Extract<MdastContent, { type: 'table' }>,
  _ctx: TransformContext
): PMNode[] {
  const result: PMNode[] = []

  for (const row of node.children) {
    if (row.type !== 'tableRow') continue

    const cells = (row.children as MdastContent[])
      .filter((cell): cell is Extract<MdastContent, { type: 'tableCell' }> => cell.type === 'tableCell')
      .map(cell => {
        // 提取单元格文本
        return cell.children
          .map(child => {
            if (child.type === 'text') return child.value
            if ('children' in child) {
              return (child.children as Array<{ type: string; value?: string }>)
                .map(c => c.value || '')
                .join('')
            }
            return ''
          })
          .join('')
      })

    const rowText = cells.join(' | ')
    if (rowText.trim()) {
      result.push({
        type: 'paragraph',
        content: [{ type: 'text', text: rowText }],
      })
    }
  }

  return result
}

/**
 * 转换图片
 */
function transformImage(
  node: Extract<MdastContent, { type: 'image' }>,
  ctx: TransformContext
): PMNode[] {
  const uploaded = ctx.uploadedImages.get(node.url)

  // 小红书编辑器 max-width 约 410px
  const XHS_MAX_WIDTH = 410

  if (uploaded) {
    // 固定宽度 410，高度按比例计算
    const displayWidth = XHS_MAX_WIDTH
    const displayHeight = uploaded.width > 0
      ? Math.round(XHS_MAX_WIDTH * uploaded.height / uploaded.width)
      : 0
    return [{
      type: 'image',
      attrs: {
        imgs: [{
          src: uploaded.url,
          desc: '',
          percent: 30,
          width: displayWidth,
          height: displayHeight,
        }],
      },
    }]
  }

  // 未上传的图片，使用原始 URL
  return [{
    type: 'image',
    attrs: {
      imgs: [{
        src: node.url,
        desc: '',
        percent: 30,
        width: XHS_MAX_WIDTH,
        height: 0,
      }],
    },
  }]
}

/**
 * 转换行内内容 (PhrasingContent)
 */
function transformPhrasingContent(
  children: MdastContent[],
  ctx: TransformContext
): PMNode[] {
  const result: PMNode[] = []

  for (const child of children) {
    switch (child.type) {
      case 'text':
        if (child.value) {
          result.push({ type: 'text', text: child.value })
        }
        break

      case 'strong':
        if (ctx.capabilities.supportBold) {
          const content = transformPhrasingContent(child.children, ctx)
          for (const node of content) {
            if (node.type === 'text') {
              node.marks = [...(node.marks || []), { type: 'bold' }]
            }
          }
          result.push(...content)
        } else if (ctx.capabilities.supportHighlight) {
          // 小红书等平台用 highlight 代替 bold
          const content = transformPhrasingContent(child.children, ctx)
          for (const node of content) {
            if (node.type === 'text') {
              node.marks = [...(node.marks || []), { type: 'highlight' }]
            }
          }
          result.push(...content)
        } else {
          result.push(...transformPhrasingContent(child.children, ctx))
        }
        break

      case 'emphasis':
        if (ctx.capabilities.supportItalic) {
          const content = transformPhrasingContent(child.children, ctx)
          for (const node of content) {
            if (node.type === 'text') {
              node.marks = [...(node.marks || []), { type: 'italic' }]
            }
          }
          result.push(...content)
        } else {
          result.push(...transformPhrasingContent(child.children, ctx))
        }
        break

      case 'delete':
        if (ctx.capabilities.supportStrikethrough) {
          const content = transformPhrasingContent(child.children, ctx)
          for (const node of content) {
            if (node.type === 'text') {
              node.marks = [...(node.marks || []), { type: 'strike' }]
            }
          }
          result.push(...content)
        } else {
          result.push(...transformPhrasingContent(child.children, ctx))
        }
        break

      case 'inlineCode':
        if (ctx.capabilities.supportInlineCode) {
          result.push({
            type: 'text',
            text: child.value,
            marks: [{ type: 'code' }],
          })
        } else {
          result.push({ type: 'text', text: child.value })
        }
        break

      case 'link':
        if (ctx.capabilities.supportLink) {
          const content = transformPhrasingContent(child.children, ctx)
          for (const node of content) {
            if (node.type === 'text') {
              node.marks = [...(node.marks || []), { type: 'link', attrs: { href: child.url } }]
            }
          }
          result.push(...content)
        } else {
          // 降级：只保留文本
          result.push(...transformPhrasingContent(child.children, ctx))
        }
        break

      case 'image':
        // 行内图片转换为块级图片，这里跳过
        // 图片应该在块级处理
        break

      case 'break':
        // 小红书不支持 hardBreak，跳过
        break

      default:
        // 其他类型尝试提取文本
        if ('children' in child && Array.isArray(child.children)) {
          result.push(...transformPhrasingContent(child.children as MdastContent[], ctx))
        }
    }
  }

  return result
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
