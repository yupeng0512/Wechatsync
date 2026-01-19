/**
 * 平台能力配置
 * 定义各平台支持的内容格式
 */

import type { PlatformCapabilities } from './types'

/**
 * 小红书平台能力
 * 基于实际测试：支持 heading, list, blockquote, highlight
 * 不支持：table, horizontalRule, code block
 */
export const xiaohongshuCapabilities: PlatformCapabilities = {
  id: 'xiaohongshu',
  outputFormat: 'prosemirror',
  maxHeadingLevel: 3,
  supportNestedList: false,
  supportTable: false,
  supportCodeBlock: false,
  supportInlineCode: false,
  supportLink: false,  // 小红书不支持外链
  supportImage: true,
  supportBlockquote: true,
  supportHorizontalRule: false,
  supportBold: false,  // 小红书不支持 bold mark，用 highlight 代替
  supportItalic: false,  // 小红书不支持 italic mark
  supportStrikethrough: false,
  supportHighlight: true,  // 小红书用 highlight 作为强调样式
  supportLatex: false,
}

/**
 * 掘金平台能力
 */
export const juejinCapabilities: PlatformCapabilities = {
  id: 'juejin',
  outputFormat: 'markdown',
  maxHeadingLevel: 6,
  supportNestedList: true,
  supportTable: true,
  supportCodeBlock: true,
  supportInlineCode: true,
  supportLink: true,
  supportImage: true,
  supportBlockquote: true,
  supportHorizontalRule: true,
  supportBold: true,
  supportItalic: true,
  supportStrikethrough: true,
  supportHighlight: false,
  supportLatex: true,
}

/**
 * 知乎平台能力
 */
export const zhihuCapabilities: PlatformCapabilities = {
  id: 'zhihu',
  outputFormat: 'html',
  maxHeadingLevel: 4,
  supportNestedList: false,
  supportTable: true,
  supportCodeBlock: true,
  supportInlineCode: true,
  supportLink: false,  // 知乎链接会被过滤
  supportImage: true,
  supportBlockquote: true,
  supportHorizontalRule: true,
  supportBold: true,
  supportItalic: true,
  supportStrikethrough: true,
  supportHighlight: false,
  supportLatex: true,
}

/**
 * 所有平台能力配置
 */
export const platformCapabilities: Record<string, PlatformCapabilities> = {
  xiaohongshu: xiaohongshuCapabilities,
  juejin: juejinCapabilities,
  zhihu: zhihuCapabilities,
}

/**
 * 获取平台能力配置
 */
export function getCapabilities(platform: string): PlatformCapabilities | undefined {
  return platformCapabilities[platform]
}

/**
 * 默认能力配置（全功能）
 */
export const defaultCapabilities: PlatformCapabilities = {
  id: 'default',
  outputFormat: 'markdown',
  maxHeadingLevel: 6,
  supportNestedList: true,
  supportTable: true,
  supportCodeBlock: true,
  supportInlineCode: true,
  supportLink: true,
  supportImage: true,
  supportBlockquote: true,
  supportHorizontalRule: true,
  supportBold: true,
  supportItalic: true,
  supportStrikethrough: true,
  supportHighlight: true,
  supportLatex: true,
}
