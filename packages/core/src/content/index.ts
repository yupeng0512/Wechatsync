/**
 * 内容转换系统
 *
 * 统一的 Markdown → 平台特定格式转换
 *
 * 架构：
 *   Markdown
 *      │
 *      ▼
 *   mdast (通用 AST)
 *      │
 *      ▼
 *   平台适配器 + 降级逻辑
 *      │
 *      ▼
 *   ProseMirror JSON / Markdown / HTML
 */

export * from './types'
export * from './capabilities'
export * from './parser'
export { mdastToProseMirror } from './transforms/prosemirror'

import { parseMarkdown } from './parser'
import { mdastToProseMirror } from './transforms/prosemirror'
import { getCapabilities, defaultCapabilities } from './capabilities'
import type { TransformOptions, TransformResult, PMNode, ImageUploader } from './types'

/**
 * 将 Markdown 转换为目标平台格式
 *
 * @example
 * ```ts
 * const result = await transformContent(markdown, {
 *   platform: 'xiaohongshu',
 *   uploadImage: async (src) => {
 *     const url = await uploadToXHS(src)
 *     return { url, width: 800, height: 600 }
 *   },
 * })
 *
 * // result.prosemirror 可直接用于小红书草稿
 * ```
 */
export async function transformContent(
  markdown: string,
  options: TransformOptions
): Promise<TransformResult> {
  const capabilities = getCapabilities(options.platform) || defaultCapabilities

  // 解析 Markdown 为 AST
  const tree = parseMarkdown(markdown)

  // 根据平台输出格式转换
  if (capabilities.outputFormat === 'prosemirror') {
    const prosemirror = await mdastToProseMirror(tree, capabilities, {
      uploadImage: options.uploadImage,
      onImageProgress: options.onImageProgress,
    })

    return { prosemirror }
  }

  // TODO: 支持 markdown 和 html 输出
  throw new Error(`Output format "${capabilities.outputFormat}" not implemented yet`)
}

/**
 * 直接转换为小红书 ProseMirror 格式
 * 便捷方法
 */
export async function transformForXiaohongshu(
  markdown: string,
  uploadImage?: ImageUploader,
  onImageProgress?: (current: number, total: number) => void
): Promise<PMNode> {
  const result = await transformContent(markdown, {
    platform: 'xiaohongshu',
    uploadImage,
    onImageProgress,
  })

  return result.prosemirror!
}
