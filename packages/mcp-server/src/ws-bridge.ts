/**
 * WebSocket Bridge - 与 Chrome Extension 通讯
 *
 * 支持多实例模式：
 * - 第一个实例启动 WebSocket 服务器 + HTTP API
 * - 后续实例通过 HTTP API 转发请求
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import wsModule from 'ws'
import http from 'http'
import type { RequestMessage, ResponseMessage } from './types.js'

// 兼容 CJS 和 ESM 打包
const WsModule = wsModule as any
// ESM: WebSocketServer, CJS: Server
const WebSocketServer = WsModule.WebSocketServer || WsModule.Server || WsModule.default?.WebSocketServer || WsModule.default?.Server
// WebSocket 状态常量 (readyState: 1 = OPEN)
const WS_OPEN = 1

export class ExtensionBridge {
  private wss: any = null
  private httpServer: http.Server | null = null
  private client: any = null
  private isServerMode = false
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()
  private requestTimeout = 360000 // 6 minutes (图片多时需要更长时间)
  private connectionResolvers: Array<() => void> = []

  // 安全验证 token（从环境变量读取，优先使用 WECHATSYNC_TOKEN）
  private token: string = process.env.WECHATSYNC_TOKEN || process.env.MCP_TOKEN || ''

  // 是否静默模式（CLI 使用时不输出日志）
  private silent: boolean = false

  constructor(private port: number = 9527, options?: { silent?: boolean }) {
    this.silent = options?.silent ?? false
    if (!this.silent) {
      if (this.token) {
        console.error('[Bridge] Token authentication enabled')
      } else {
        console.error('[Bridge] Warning: MCP_TOKEN not set, requests may be rejected by extension')
      }
    }
  }

  /**
   * 启动服务 - 自动选择服务器模式或客户端模式
   */
  async start(): Promise<void> {
    try {
      await this.startServer()
      this.isServerMode = true
      if (!this.silent) console.error(`[Bridge] Running as PRIMARY (WebSocket: ${this.port}, HTTP: ${this.port + 1})`)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        this.isServerMode = false
        if (!this.silent) console.error(`[Bridge] Running as SECONDARY (forwarding to localhost:${this.port + 1})`)
      } else {
        throw error
      }
    }
  }

  /**
   * 启动 WebSocket 服务器 + HTTP API
   */
  private startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port })

        this.wss.on('listening', () => {
          if (!this.silent) console.error(`[Bridge] WebSocket server listening on port ${this.port}`)
          // WebSocket 启动成功后，启动 HTTP API
          this.startHttpApi()
            .then(resolve)
            .catch(reject)
        })

        this.wss.on('connection', (ws: any) => {
          if (!this.silent) console.error('[Bridge] Extension connected')
          this.client = ws

          // 通知等待连接的 Promise
          for (const resolver of this.connectionResolvers) {
            resolver()
          }
          this.connectionResolvers = []

          ws.on('message', (data: any) => {
            this.handleMessage(data.toString())
          })

          ws.on('close', () => {
            if (!this.silent) console.error('[Bridge] Extension disconnected')
            this.client = null
          })

          ws.on('error', (error: Error) => {
            if (!this.silent) console.error('[Bridge] WebSocket error:', error)
          })
        })

        this.wss.on('error', (error: Error) => {
          reject(error)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * 启动 HTTP API 服务器（供其他 MCP 实例调用）
   */
  private startHttpApi(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(async (req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
          res.writeHead(200)
          res.end()
          return
        }

        if (req.method === 'GET' && req.url === '/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            connected: this.isConnected(),
            mode: 'primary'
          }))
          return
        }

        if (req.method === 'POST' && req.url === '/request') {
          let body = ''
          req.on('data', chunk => body += chunk)
          req.on('end', async () => {
            try {
              const { method, params } = JSON.parse(body)
              const result = await this.requestInternal(method, params)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ result }))
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: (error as Error).message }))
            }
          })
          return
        }

        res.writeHead(404)
        res.end('Not found')
      })

      const httpPort = this.port + 1
      this.httpServer.listen(httpPort, () => {
        if (!this.silent) console.error(`[Bridge] HTTP API listening on port ${httpPort}`)
        resolve()
      })

      this.httpServer.on('error', reject)
    })
  }

  /**
   * 停止服务器
   */
  stop(): void {
    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
  }

  /**
   * 检查 Extension 是否已连接
   */
  isConnected(): boolean {
    if (this.isServerMode) {
      return this.client !== null && this.client.readyState === WS_OPEN
    } else {
      // 客户端模式：无法同步检查，返回 true 让实际请求时验证
      return true
    }
  }

  /**
   * 等待 Extension 连接
   */
  waitForConnection(timeoutMs: number = 60000): Promise<void> {
    if (this.isConnected()) {
      return Promise.resolve()
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.connectionResolvers.indexOf(resolve)
        if (index > -1) {
          this.connectionResolvers.splice(index, 1)
        }
        reject(new Error('timeout'))
      }, timeoutMs)

      this.connectionResolvers.push(() => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  /**
   * 检查 Primary 实例健康状态（Secondary 模式用）
   */
  private async checkPrimaryHealth(): Promise<{ connected: boolean; error?: string }> {
    return new Promise((resolve) => {
      const options = {
        hostname: 'localhost',
        port: this.port + 1,
        path: '/status',
        method: 'GET',
        timeout: 3000,
      }

      const req = http.request(options, (res) => {
        let body = ''
        res.on('data', chunk => body += chunk)
        res.on('end', () => {
          try {
            const status = JSON.parse(body)
            resolve({ connected: status.connected })
          } catch {
            resolve({ connected: false, error: 'Invalid response from primary' })
          }
        })
      })

      req.on('error', (error) => {
        resolve({ connected: false, error: `Primary not reachable: ${error.message}` })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({ connected: false, error: 'Primary health check timeout' })
      })

      req.end()
    })
  }

  /**
   * 发送请求到 Extension 并等待响应
   */
  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.isServerMode) {
      return this.requestInternal<T>(method, params)
    } else {
      // Secondary 模式：先检查 Primary 健康状态
      const health = await this.checkPrimaryHealth()
      if (!health.connected) {
        throw new Error(
          health.error ||
          'Primary MCP instance not available. Please ensure only one Claude Code session is using MCP.'
        )
      }
      return this.requestViaHttp<T>(method, params)
    }
  }

  /**
   * 直接通过 WebSocket 发送请求（服务器模式）
   */
  private async requestInternal<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.client || this.client.readyState !== WS_OPEN) {
      throw new Error('Extension not connected. Please ensure the Chrome extension is running.')
    }

    const id = this.generateId()
    const message: RequestMessage = {
      id,
      method,
      token: this.token,  // 发送 token 供插件端验证
      params
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, this.requestTimeout)

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout })

      this.client!.send(JSON.stringify(message))
    })
  }

  /**
   * 通过 HTTP API 转发请求（客户端模式）
   */
  private requestViaHttp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ method, params })
      const options = {
        hostname: 'localhost',
        port: this.port + 1,
        path: '/request',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      }

      const req = http.request(options, (res) => {
        let body = ''
        res.on('data', chunk => body += chunk)
        res.on('end', () => {
          try {
            const response = JSON.parse(body)
            if (response.error) {
              reject(new Error(response.error))
            } else {
              resolve(response.result)
            }
          } catch (error) {
            reject(new Error('Failed to parse response'))
          }
        })
      })

      req.on('error', (error) => {
        const hint = error.message.includes('ECONNREFUSED')
          ? ' (Is the primary MCP server running?)'
          : ''
        reject(new Error(`Failed to connect to primary MCP instance: ${error.message}${hint}`))
      })

      req.setTimeout(this.requestTimeout, () => {
        req.destroy()
        reject(new Error(`Request timeout: ${method}`))
      })

      req.write(data)
      req.end()
    })
  }

  /**
   * 处理来自 Extension 的消息
   */
  private handleMessage(data: string): void {
    try {
      const message: ResponseMessage = JSON.parse(data)

      const pending = this.pendingRequests.get(message.id)
      if (!pending) {
        console.error('[Bridge] Unknown response id:', message.id)
        return
      }

      clearTimeout(pending.timeout)
      this.pendingRequests.delete(message.id)

      if (message.error) {
        pending.reject(new Error(message.error.message))
      } else {
        pending.resolve(message.result)
      }
    } catch (error) {
      console.error('[Bridge] Failed to parse message:', error)
    }
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }

  // 分片上传配置
  private readonly CHUNK_SIZE = 512 * 1024  // 512KB per chunk
  private readonly CHUNK_THRESHOLD = 1024 * 1024  // 1MB threshold for chunking

  /**
   * 分片上传图片
   * 大于 1MB 的图片会自动分片上传
   */
  async uploadImageChunked(
    imageData: string,
    mimeType: string,
    platform: string = 'weibo'
  ): Promise<{ url: string; platform: string }> {
    // 小于阈值，直接上传
    if (imageData.length < this.CHUNK_THRESHOLD) {
      return this.request('uploadImage', { imageData, mimeType, platform })
    }

    // 大图片，分片上传
    const uploadId = this.generateId()
    const chunks: string[] = []

    // 分割 base64 数据
    for (let i = 0; i < imageData.length; i += this.CHUNK_SIZE) {
      chunks.push(imageData.slice(i, i + this.CHUNK_SIZE))
    }

    console.error(`[Bridge] Chunked upload: ${chunks.length} chunks, total size: ${imageData.length}`)

    // 1. 发送开始消息
    await this.request('uploadImage:start', {
      uploadId,
      totalChunks: chunks.length,
      mimeType,
      platform,
    })

    // 2. 逐个发送分片
    for (let i = 0; i < chunks.length; i++) {
      await this.request('uploadImage:chunk', {
        uploadId,
        chunkIndex: i,
        data: chunks[i],
      })
    }

    // 3. 发送完成消息并获取结果
    const result = await this.request<{ url: string; platform: string }>('uploadImage:complete', {
      uploadId,
    })

    return result
  }
}
