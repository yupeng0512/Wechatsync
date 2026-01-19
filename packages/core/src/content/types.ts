/**
 * 内容转换系统类型定义
 * 自定义 mdast 兼容类型，避免外部依赖
 */

/**
 * mdast 根节点
 */
export interface MdastRoot {
  type: 'root'
  children: MdastContent[]
}

/**
 * mdast 内容节点类型
 */
export type MdastContent =
  | MdastHeading
  | MdastParagraph
  | MdastBlockquote
  | MdastList
  | MdastListItem
  | MdastTable
  | MdastTableRow
  | MdastTableCell
  | MdastCode
  | MdastThematicBreak
  | MdastImage
  | MdastLink
  | MdastStrong
  | MdastEmphasis
  | MdastDelete
  | MdastInlineCode
  | MdastText
  | MdastBreak

export interface MdastHeading {
  type: 'heading'
  depth: 1 | 2 | 3 | 4 | 5 | 6
  children: MdastContent[]
}

export interface MdastParagraph {
  type: 'paragraph'
  children: MdastContent[]
}

export interface MdastBlockquote {
  type: 'blockquote'
  children: MdastContent[]
}

export interface MdastList {
  type: 'list'
  ordered: boolean
  start?: number
  children: MdastContent[]
}

export interface MdastListItem {
  type: 'listItem'
  children: MdastContent[]
}

export interface MdastTable {
  type: 'table'
  children: MdastContent[]
}

export interface MdastTableRow {
  type: 'tableRow'
  children: MdastContent[]
}

export interface MdastTableCell {
  type: 'tableCell'
  children: MdastContent[]
}

export interface MdastCode {
  type: 'code'
  lang?: string
  value: string
}

export interface MdastThematicBreak {
  type: 'thematicBreak'
}

export interface MdastImage {
  type: 'image'
  url: string
  alt?: string
}

export interface MdastLink {
  type: 'link'
  url: string
  children: MdastContent[]
}

export interface MdastStrong {
  type: 'strong'
  children: MdastContent[]
}

export interface MdastEmphasis {
  type: 'emphasis'
  children: MdastContent[]
}

export interface MdastDelete {
  type: 'delete'
  children: MdastContent[]
}

export interface MdastInlineCode {
  type: 'inlineCode'
  value: string
}

export interface MdastText {
  type: 'text'
  value: string
}

export interface MdastBreak {
  type: 'break'
}

/**
 * 平台能力配置
 */
export interface PlatformCapabilities {
  /** 平台 ID */
  id: string
  /** 输出格式 */
  outputFormat: 'prosemirror' | 'markdown' | 'html'
  /** 支持的最大标题级别 (1-6) */
  maxHeadingLevel: number
  /** 支持嵌套列表 */
  supportNestedList: boolean
  /** 支持表格 */
  supportTable: boolean
  /** 支持代码块 */
  supportCodeBlock: boolean
  /** 支持行内代码 */
  supportInlineCode: boolean
  /** 支持链接 */
  supportLink: boolean
  /** 支持图片 */
  supportImage: boolean
  /** 支持引用块 */
  supportBlockquote: boolean
  /** 支持分割线 */
  supportHorizontalRule: boolean
  /** 支持粗体 */
  supportBold: boolean
  /** 支持斜体 */
  supportItalic: boolean
  /** 支持删除线 */
  supportStrikethrough: boolean
  /** 支持高亮 */
  supportHighlight: boolean
  /** 支持 LaTeX */
  supportLatex: boolean
}

/**
 * ProseMirror 节点
 */
export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: PMark[]
}

/**
 * ProseMirror 标记
 */
export interface PMark {
  type: string
  attrs?: Record<string, unknown>
}

/**
 * 图片上传函数
 */
export type ImageUploader = (src: string) => Promise<{
  url: string
  width?: number
  height?: number
  fileId?: string
}>

/**
 * 转换选项
 */
export interface TransformOptions {
  /** 目标平台 ID */
  platform: string
  /** 图片上传函数 */
  uploadImage?: ImageUploader
  /** 图片上传进度回调 */
  onImageProgress?: (current: number, total: number) => void
}

/**
 * 转换结果
 */
export interface TransformResult {
  /** ProseMirror JSON (用于小红书等) */
  prosemirror?: PMNode
  /** Markdown 输出 */
  markdown?: string
  /** HTML 输出 */
  html?: string
}
