/**
 * WordPress XML-RPC 适配器
 */
import { createLogger } from '../../lib/logger'
import { parseMarkdownImages } from '@wechatsync/core'

const logger = createLogger('WordPress')

interface WordPressCredentials {
  url: string
  username: string
  password: string
}

interface WordPressPost {
  post_title: string
  post_content: string
  post_status: 'draft' | 'publish'
  post_type?: string
}

interface ImageUploadResult {
  url: string
}

/**
 * 构建 XML-RPC 请求体
 */
function buildXmlRpcRequest(method: string, params: unknown[]): string {
  const paramXml = params.map(param => {
    if (typeof param === 'string') {
      return `<param><value><string>${escapeXml(param)}</string></value></param>`
    }
    if (typeof param === 'number') {
      return `<param><value><int>${param}</int></value></param>`
    }
    if (typeof param === 'object' && param !== null) {
      return `<param><value><struct>${objectToXmlRpcStruct(param as Record<string, unknown>)}</struct></value></param>`
    }
    return `<param><value><string>${String(param)}</string></value></param>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>${method}</methodName>
  <params>${paramXml}</params>
</methodCall>`
}

function objectToXmlRpcStruct(obj: Record<string, unknown>): string {
  return Object.entries(obj).map(([key, value]) => {
    let valueXml: string
    if (typeof value === 'string') {
      valueXml = `<string>${escapeXml(value)}</string>`
    } else if (typeof value === 'number') {
      valueXml = `<int>${value}</int>`
    } else if (typeof value === 'boolean') {
      valueXml = `<boolean>${value ? 1 : 0}</boolean>`
    } else if (value instanceof Uint8Array) {
      // Base64 编码的二进制数据
      valueXml = `<base64>${arrayBufferToBase64(value)}</base64>`
    } else {
      valueXml = `<string>${escapeXml(String(value))}</string>`
    }
    return `<member><name>${key}</name><value>${valueXml}</value></member>`
  }).join('')
}

/**
 * 将 Uint8Array 转换为 base64 字符串
 */
function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = ''
  const len = buffer.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary)
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 解析 XML-RPC 响应
 */
function parseXmlRpcResponse(xml: string): { success: boolean; value?: unknown; error?: string } {
  // 检查是否有 fault
  if (xml.includes('<fault>')) {
    const faultMatch = xml.match(/<string>([^<]+)<\/string>/)
    return { success: false, error: faultMatch?.[1] || 'XML-RPC 错误' }
  }

  // 提取返回值
  const valueMatch = xml.match(/<value>[\s\S]*?<(string|int|boolean)>([^<]*)<\/\1>/)
  if (valueMatch) {
    return { success: true, value: valueMatch[2] }
  }

  // 检查 struct 返回
  if (xml.includes('<struct>')) {
    return { success: true, value: {} }
  }

  return { success: true }
}

/**
 * 测试 WordPress 连接
 */
export async function testConnection(credentials: WordPressCredentials): Promise<{ success: boolean; error?: string }> {
  const xmlrpcUrl = credentials.url.replace(/\/$/, '') + '/xmlrpc.php'

  try {
    const body = buildXmlRpcRequest('wp.getUsersBlogs', [
      credentials.username,
      credentials.password,
    ])

    const response = await fetch(xmlrpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
      },
      body,
    })

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const xml = await response.text()
    const result = parseXmlRpcResponse(xml)

    if (!result.success) {
      return { success: false, error: result.error }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

/**
 * 上传图片到 WordPress
 */
export async function uploadImage(
  credentials: WordPressCredentials,
  imageData: Uint8Array,
  filename: string,
  mimeType: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  const xmlrpcUrl = credentials.url.replace(/\/$/, '') + '/xmlrpc.php'

  try {
    const fileData = {
      name: filename,
      type: mimeType,
      bits: imageData,
      overwrite: true,
    }

    const body = buildXmlRpcRequest('wp.uploadFile', [
      0, // blog_id
      credentials.username,
      credentials.password,
      fileData,
    ])

    const response = await fetch(xmlrpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
      },
      body,
    })

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const xml = await response.text()

    // 解析上传结果，提取 URL
    const urlMatch = xml.match(/<name>url<\/name>\s*<value>(?:<string>)?([^<]+)(?:<\/string>)?<\/value>/)
    if (urlMatch) {
      return { success: true, url: urlMatch[1] }
    }

    // 检查错误
    if (xml.includes('<fault>')) {
      const faultMatch = xml.match(/<string>([^<]+)<\/string>/)
      return { success: false, error: faultMatch?.[1] || 'Upload failed' }
    }

    return { success: false, error: '无法解析上传结果' }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

/**
 * 根据 MIME 类型获取文件扩展名
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
  }
  return mimeToExt[mimeType] || '.jpg'
}

const MAX_RETRY_ATTEMPTS = 10
const RETRY_DELAY_MS = 1000 // 基础延迟 1 秒

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 从 URL 下载图片并上传到 WordPress（带重试机制）
 */
export async function uploadImageByUrl(
  credentials: WordPressCredentials,
  imageUrl: string,
  signal?: AbortSignal
): Promise<ImageUploadResult | null> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    // 检查是否已取消
    if (signal?.aborted) {
      logger.debug(` Upload aborted for: ${imageUrl}`)
      return null
    }

    try {
      const result = await doUploadImageByUrl(credentials, imageUrl, signal)
      if (result) {
        if (attempt > 1) {
          logger.debug(` Upload succeeded on attempt ${attempt}: ${imageUrl}`)
        }
        return result
      }
      // result 为 null 表示失败，继续重试
      logger.warn(` Upload attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed for: ${imageUrl}`)
    } catch (error) {
      lastError = error as Error
      logger.warn(` Upload attempt ${attempt}/${MAX_RETRY_ATTEMPTS} error:`, error)
    }

    // 如果不是最后一次尝试，等待后重试
    if (attempt < MAX_RETRY_ATTEMPTS) {
      const delayMs = RETRY_DELAY_MS * attempt // 递增延迟
      logger.debug(` Retrying in ${delayMs}ms...`)
      await delay(delayMs)
    }
  }

  logger.error(` All ${MAX_RETRY_ATTEMPTS} upload attempts failed for: ${imageUrl}`, lastError)
  return null
}

/**
 * 实际执行图片下载和上传
 */
async function doUploadImageByUrl(
  credentials: WordPressCredentials,
  imageUrl: string,
  signal?: AbortSignal
): Promise<ImageUploadResult | null> {
  // 下载图片 (带超时)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000) // 30秒超时

  // 如果有外部 signal，监听它
  if (signal) {
    signal.addEventListener('abort', () => controller.abort())
  }

  try {
    const response = await fetch(imageUrl, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      logger.error(` Failed to download image (HTTP ${response.status}): ${imageUrl}`)
      return null
    }

    const blob = await response.blob()
    const arrayBuffer = await blob.arrayBuffer()
    const imageData = new Uint8Array(arrayBuffer)

    // 获取 MIME 类型
    const mimeType = blob.type || 'image/jpeg'

    // 生成带正确扩展名的文件名
    let filename = ''
    try {
      const url = new URL(imageUrl)
      const pathParts = url.pathname.split('/')
      const lastPart = pathParts[pathParts.length - 1]

      // 检查是否有有效扩展名
      if (lastPart && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(lastPart)) {
        filename = lastPart
      } else {
        // 检查查询参数中是否有格式信息 (如微信的 wx_fmt=png)
        const wxFmt = url.searchParams.get('wx_fmt')
        if (wxFmt) {
          filename = `image_${Date.now()}.${wxFmt}`
        }
      }
    } catch {
      // URL 解析失败
    }

    // 如果还没有文件名，根据 MIME 类型生成
    if (!filename) {
      const ext = getExtensionFromMimeType(mimeType)
      filename = `image_${Date.now()}${ext}`
    }

    logger.debug(` Uploading image: ${filename}, type: ${mimeType}`)

    // 上传到 WordPress
    const result = await uploadImage(credentials, imageData, filename, mimeType)
    if (result.success && result.url) {
      return { url: result.url }
    }

    logger.error(` Failed to upload image: ${result.error}`)
    return null
  } catch (error) {
    clearTimeout(timeoutId)
    throw error // 向上抛出以触发重试
  }
}

/**
 * 处理文章中的图片，上传到 WordPress 并替换 URL
 * @throws 当图片上传失败时抛出错误
 */
export async function processArticleImages(
  credentials: WordPressCredentials,
  content: string,
  onProgress?: (current: number, total: number) => void,
  signal?: AbortSignal
): Promise<string> {
  // 提取所有图片 URL
  const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi
  const matches: { full: string; src: string }[] = []

  let match
  while ((match = imgRegex.exec(content)) !== null) {
    matches.push({ full: match[0], src: match[1] })
  }

  // 同时处理 Markdown 图片
  for (const mdMatch of parseMarkdownImages(content)) {
    matches.push({ full: mdMatch.full, src: mdMatch.src })
  }

  if (matches.length === 0) {
    return content
  }

  logger.debug(` Found ${matches.length} images to process`)

  let result = content
  const uploadedMap = new Map<string, string>()
  let processed = 0

  for (const { full, src } of matches) {
    // 检查是否已取消
    if (signal?.aborted) {
      throw new Error('操作已取消')
    }

    // 跳过空 src 和 data URI
    if (!src || src.startsWith('data:')) continue

    // 跳过已经是 WordPress 站点的图片
    const wpDomain = new URL(credentials.url).hostname
    try {
      const imgDomain = new URL(src).hostname
      if (imgDomain === wpDomain) {
        logger.debug(` Skipping same-domain image: ${src}`)
        continue
      }
    } catch {
      // URL 解析失败，继续处理
    }

    processed++
    onProgress?.(processed, matches.length)

    // 检查是否已上传过
    let newUrl = uploadedMap.get(src)

    if (!newUrl) {
      logger.debug(` Uploading image ${processed}/${matches.length}: ${src}`)
      const uploadResult = await uploadImageByUrl(credentials, src, signal)
      if (uploadResult?.url) {
        newUrl = uploadResult.url
        uploadedMap.set(src, newUrl)
      } else {
        // 上传失败，抛出错误
        throw new Error(`图片上传失败 (重试 ${MAX_RETRY_ATTEMPTS} 次后): ${src.substring(0, 100)}...`)
      }
    }

    if (newUrl) {
      // 替换图片 URL
      const newTag = full.replace(src, newUrl)
      result = result.replace(full, newTag)
      logger.debug(` Image uploaded: ${newUrl}`)
    }

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  return result
}

/**
 * 发布文章到 WordPress
 */
export async function publish(
  credentials: WordPressCredentials,
  article: { title: string; content: string },
  options?: { draftOnly?: boolean; processImages?: boolean; onImageProgress?: (current: number, total: number) => void; signal?: AbortSignal }
): Promise<{ success: boolean; postId?: string; postUrl?: string; error?: string }> {
  const xmlrpcUrl = credentials.url.replace(/\/$/, '') + '/xmlrpc.php'

  try {
    // 检查是否已取消
    if (options?.signal?.aborted) {
      return { success: false, error: '操作已取消' }
    }

    // 如果启用图片处理，先处理文章中的图片
    let content = article.content
    if (options?.processImages !== false) {
      logger.debug(' Processing images before publish...')
      content = await processArticleImages(credentials, content, options?.onImageProgress, options?.signal)
    }

    // 再次检查是否已取消
    if (options?.signal?.aborted) {
      return { success: false, error: '操作已取消' }
    }

    const post: WordPressPost = {
      post_title: article.title,
      post_content: content,
      post_status: options?.draftOnly ? 'draft' : 'publish',
      post_type: 'post',
    }

    const body = buildXmlRpcRequest('wp.newPost', [
      0, // blog_id
      credentials.username,
      credentials.password,
      post,
    ])

    const response = await fetch(xmlrpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
      },
      body,
    })

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const xml = await response.text()
    const result = parseXmlRpcResponse(xml)

    if (!result.success) {
      return { success: false, error: result.error }
    }

    const postId = String(result.value)
    const postUrl = options?.draftOnly
      ? `${credentials.url.replace(/\/$/, '')}/wp-admin/post.php?post=${postId}&action=edit`
      : `${credentials.url.replace(/\/$/, '')}/?p=${postId}`

    return { success: true, postId, postUrl }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
