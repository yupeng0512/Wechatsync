/**
 * 微信公众号页面 Content Script
 * 优化的同步按钮体验
 */

;(() => {
interface Platform {
  id: string
  name: string
  icon: string
  isAuthenticated: boolean
}

interface SyncState {
  status: 'idle' | 'syncing' | 'success' | 'error'
  platforms: Platform[]
  results: Array<{ platform: string; success: boolean; postUrl?: string; error?: string }>
}

const state: SyncState = {
  status: 'idle',
  platforms: [],
  results: [],
}

function injectSyncButton() {
  // 检查是否是文章页面
  const articleContent = document.querySelector('#js_content')
  if (!articleContent) return

  // 检查是否已注入
  if (document.querySelector('#wechatsync-fab')) return

  // 创建悬浮按钮容器
  const container = document.createElement('div')
  container.id = 'wechatsync-fab'
  container.innerHTML = `
    <style>
      #wechatsync-fab {
        position: fixed;
        right: 24px;
        bottom: 88px;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      /* 主按钮 - 胶囊形状带文字 */
      .wechatsync-main-btn {
        height: 40px;
        padding: 0 16px;
        border-radius: 20px;
        background: linear-gradient(135deg, #07c160 0%, #06ad56 100%);
        border: none;
        box-shadow: 0 4px 12px rgba(7, 193, 96, 0.35);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        color: white;
        font-size: 14px;
        font-weight: 500;
      }

      .wechatsync-main-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 20px rgba(7, 193, 96, 0.45);
      }

      .wechatsync-main-btn svg {
        width: 18px;
        height: 18px;
        fill: white;
        transition: transform 0.3s;
      }

      /* 同步中旋转动画 */
      .wechatsync-main-btn.syncing svg {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      /* 成功状态 */
      .wechatsync-main-btn.success {
        background: linear-gradient(135deg, #52c41a 0%, #389e0d 100%);
      }

      /* 失败状态 */
      .wechatsync-main-btn.error {
        background: linear-gradient(135deg, #ff4d4f 0%, #cf1322 100%);
      }

      /* 平台展开面板 */
      .wechatsync-panel {
        position: absolute;
        bottom: 60px;
        right: 0;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        padding: 12px;
        min-width: 200px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(10px) scale(0.95);
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }

      #wechatsync-fab:hover .wechatsync-panel,
      #wechatsync-fab.expanded .wechatsync-panel {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }

      .wechatsync-panel-header {
        font-size: 12px;
        color: #999;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid #f0f0f0;
      }

      /* 平台列表 */
      .wechatsync-platforms {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }

      .wechatsync-platform {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
        border: 2px solid transparent;
        background: #f5f5f5;
        font-size: 12px;
      }

      .wechatsync-platform:hover {
        background: #e8f5e9;
      }

      .wechatsync-platform.selected {
        border-color: #07c160;
        background: #e8f5e9;
      }

      .wechatsync-platform img {
        width: 16px;
        height: 16px;
        border-radius: 3px;
      }

      .wechatsync-platform .status-icon {
        margin-left: auto;
      }

      .wechatsync-platform .status-icon.success {
        color: #52c41a;
      }

      .wechatsync-platform .status-icon.error {
        color: #ff4d4f;
      }

      /* 操作按钮 */
      .wechatsync-actions {
        display: flex;
        gap: 8px;
      }

      .wechatsync-sync-btn {
        flex: 1;
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        background: #07c160;
        color: white;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
      }

      .wechatsync-sync-btn:hover {
        background: #06ad56;
      }

      .wechatsync-sync-btn:disabled {
        background: #ccc;
        cursor: not-allowed;
      }

      .wechatsync-more-btn {
        padding: 8px 12px;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        background: white;
        color: #666;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
      }

      .wechatsync-more-btn:hover {
        border-color: #07c160;
        color: #07c160;
      }

      /* 结果提示 */
      .wechatsync-toast {
        position: absolute;
        bottom: 60px;
        right: 0;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        padding: 12px 16px;
        font-size: 13px;
        white-space: nowrap;
        opacity: 0;
        visibility: hidden;
        transform: translateY(10px);
        transition: all 0.2s;
      }

      .wechatsync-toast.show {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .wechatsync-toast.success {
        border-left: 3px solid #52c41a;
      }

      .wechatsync-toast.error {
        border-left: 3px solid #ff4d4f;
      }

      .wechatsync-toast.warning {
        border-left: 3px solid #faad14;
        background: #fffbe6;
      }

      /* 加载状态 */
      .wechatsync-loading {
        text-align: center;
        padding: 20px;
        color: #999;
        font-size: 12px;
      }

      /* 同步结果列表 */
      .wechatsync-results {
        margin-bottom: 12px;
        max-height: 200px;
        overflow-y: auto;
      }

      .wechatsync-result-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 6px;
        margin-bottom: 6px;
        font-size: 12px;
      }

      .wechatsync-result-item.success {
        background: #f6ffed;
        border: 1px solid #b7eb8f;
      }

      .wechatsync-result-item.error {
        background: #fff2f0;
        border: 1px solid #ffccc7;
      }

      .wechatsync-result-item img {
        width: 16px;
        height: 16px;
        border-radius: 3px;
      }

      .wechatsync-result-item .name {
        flex: 1;
      }

      .wechatsync-result-item .status {
        font-size: 11px;
      }

      .wechatsync-result-item .status.success {
        color: #52c41a;
        background: none;
        border: none;
      }

      .wechatsync-result-item .status.error {
        color: #ff4d4f;
        background: none;
        border: none;
      }

      .wechatsync-result-item a {
        color: #1890ff;
        text-decoration: none;
        font-size: 11px;
      }

      .wechatsync-result-item a:hover {
        text-decoration: underline;
      }

      /* 底部链接 */
      .wechatsync-footer {
        display: flex;
        justify-content: space-between;
        padding-top: 8px;
        border-top: 1px solid #f0f0f0;
        margin-top: 8px;
      }

      .wechatsync-footer a {
        color: #999;
        text-decoration: none;
        font-size: 11px;
      }

      .wechatsync-footer a:hover {
        color: #07c160;
      }
    </style>

    <div class="wechatsync-panel">
      <div class="wechatsync-panel-header" id="wechatsync-panel-header">选择同步平台</div>

      <!-- 同步结果区域（同步后显示） -->
      <div class="wechatsync-results" id="wechatsync-results" style="display: none;"></div>

      <!-- 平台选择区域 -->
      <div class="wechatsync-platforms" id="wechatsync-platforms">
        <div class="wechatsync-loading">加载中...</div>
      </div>

      <div class="wechatsync-actions">
        <button class="wechatsync-sync-btn" id="wechatsync-sync-btn" disabled>
          同步到选中平台
        </button>
        <button class="wechatsync-more-btn" id="wechatsync-more-btn" title="更多选项">
          ⋯
        </button>
      </div>

      <div class="wechatsync-footer">
        <a href="javascript:void(0)" id="wechatsync-history-link">同步历史</a>
        <a href="javascript:void(0)" id="wechatsync-add-cms-link">添加站点</a>
      </div>
    </div>

    <div class="wechatsync-toast" id="wechatsync-toast"></div>

    <button class="wechatsync-main-btn" id="wechatsync-main-btn" title="同步文章到多平台">
      <svg viewBox="0 0 24 24">
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
      </svg>
      <span>同步</span>
    </button>
  `

  document.body.appendChild(container)

  // 绑定事件
  const mainBtn = document.getElementById('wechatsync-main-btn') as HTMLButtonElement
  const syncBtn = document.getElementById('wechatsync-sync-btn') as HTMLButtonElement
  const moreBtn = document.getElementById('wechatsync-more-btn') as HTMLButtonElement
  const platformsContainer = document.getElementById('wechatsync-platforms')!
  const resultsContainer = document.getElementById('wechatsync-results')!
  const panelHeader = document.getElementById('wechatsync-panel-header')!
  const historyLink = document.getElementById('wechatsync-history-link')!
  const addCmsLink = document.getElementById('wechatsync-add-cms-link')!

  // 加载平台列表
  loadPlatforms()

  // 主按钮点击 - 展开/收起
  mainBtn.addEventListener('click', () => {
    container.classList.toggle('expanded')
  })

  // 同步按钮
  syncBtn.addEventListener('click', () => startSync())

  // 更多选项 - 打开完整 popup
  moreBtn.addEventListener('click', async () => {
    const article = extractWeixinArticle()
    if (article) {
      await chrome.storage.local.set({ pendingArticle: article })
    }
    chrome.runtime.sendMessage({ type: 'OPEN_SYNC_PAGE' })
  })

  // 历史记录链接
  historyLink.addEventListener('click', (e) => {
    e.preventDefault()
    chrome.runtime.sendMessage({ type: 'OPEN_SYNC_PAGE', path: '/history' })
  })

  // 添加站点链接
  addCmsLink.addEventListener('click', (e) => {
    e.preventDefault()
    chrome.runtime.sendMessage({ type: 'OPEN_SYNC_PAGE', path: '/add-cms' })
  })

  /**
   * 加载已登录平台
   */
  async function loadPlatforms() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_ALL_AUTH' })
      state.platforms = (response.platforms || []).filter((p: Platform) => p.isAuthenticated)

      // 加载上次选择的平台
      const storage = await chrome.storage.local.get('lastSelectedPlatforms')
      const lastSelected: string[] = storage.lastSelectedPlatforms || []

      renderPlatforms(lastSelected)
    } catch (error) {
      platformsContainer.innerHTML = '<div class="wechatsync-loading">加载失败</div>'
    }
  }

  /**
   * 渲染平台列表
   */
  function renderPlatforms(selectedIds: string[] = []) {
    if (state.platforms.length === 0) {
      platformsContainer.innerHTML = `
        <div class="wechatsync-loading">
          暂无已登录平台<br>
          <a href="javascript:void(0)" id="wechatsync-login-link" style="color: #07c160;">去登录 →</a>
        </div>
      `
      document.getElementById('wechatsync-login-link')?.addEventListener('click', (e) => {
        e.preventDefault()
        chrome.runtime.sendMessage({ type: 'OPEN_SYNC_PAGE' })
      })
      return
    }

    platformsContainer.innerHTML = state.platforms.map(p => {
      const isSelected = selectedIds.includes(p.id)
      const result = state.results.find(r => r.platform === p.id)
      let statusIcon = ''
      if (result) {
        statusIcon = result.success
          ? '<span class="status-icon success">✓</span>'
          : '<span class="status-icon error">✗</span>'
      }

      return `
        <div class="wechatsync-platform ${isSelected ? 'selected' : ''}" data-id="${p.id}">
          <img src="${p.icon}" alt="${p.name}" onerror="this.style.display='none'">
          <span>${p.name}</span>
          ${statusIcon}
        </div>
      `
    }).join('')

    // 绑定平台选择事件
    platformsContainer.querySelectorAll('.wechatsync-platform').forEach(el => {
      el.addEventListener('click', () => {
        el.classList.toggle('selected')
        updateSyncButton()
      })
    })

    updateSyncButton()
  }

  /**
   * 更新同步按钮状态
   */
  function updateSyncButton() {
    const selected = platformsContainer.querySelectorAll('.wechatsync-platform.selected')
    syncBtn.disabled = selected.length === 0
    syncBtn.textContent = selected.length > 0
      ? `同步到 ${selected.length} 个平台`
      : '选择平台'
  }

  /**
   * 开始同步
   */
  async function startSync() {
    const article = extractWeixinArticle()
    if (!article) {
      showToast('未能提取文章内容', 'error')
      // 追踪文章提取失败
      chrome.runtime.sendMessage({
        type: 'TRACK_ARTICLE_EXTRACT',
        payload: { source: 'weixin', success: false },
      }).catch(() => {})
      return
    }

    // 追踪文章提取成功
    chrome.runtime.sendMessage({
      type: 'TRACK_ARTICLE_EXTRACT',
      payload: {
        source: 'weixin',
        success: true,
        hasTitle: !!article.title,
        hasContent: !!article.content,
        hasCover: !!article.cover,
        contentLength: article.content?.length || 0,
      },
    }).catch(() => {})

    // 获取选中的平台
    const selectedPlatforms: string[] = []
    platformsContainer.querySelectorAll('.wechatsync-platform.selected').forEach(el => {
      selectedPlatforms.push(el.getAttribute('data-id')!)
    })

    if (selectedPlatforms.length === 0) {
      showToast('请选择要同步的平台', 'error')
      return
    }

    // 保存平台选择偏好
    await chrome.storage.local.set({ lastSelectedPlatforms: selectedPlatforms })

    // 更新状态
    state.status = 'syncing'
    state.results = []
    mainBtn.classList.add('syncing')
    mainBtn.classList.remove('success', 'error')
    syncBtn.disabled = true
    syncBtn.textContent = '同步中...'

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_ARTICLE',
        payload: { article, platforms: selectedPlatforms, source: 'weixin' },
      })

      state.results = response.results || []
      const successCount = state.results.filter(r => r.success).length
      const failedCount = state.results.filter(r => !r.success).length

      state.status = failedCount === 0 ? 'success' : 'error'
      mainBtn.classList.remove('syncing')
      mainBtn.classList.add(state.status)

      // 显示结果列表（带草稿链接）
      renderResults()

      // 显示频率限制警告（如果有）
      if (response.rateLimitWarning) {
        showToast(response.rateLimitWarning, 'warning', 8000)
      }

      // 显示 toast
      if (failedCount === 0) {
        showToast(`✓ 成功同步到 ${successCount} 个平台`, 'success')
      } else {
        showToast(`${successCount} 成功，${failedCount} 失败`, 'error')
      }

    } catch (error) {
      state.status = 'error'
      mainBtn.classList.remove('syncing')
      mainBtn.classList.add('error')
      showToast('同步失败：' + (error as Error).message, 'error')
    }

  }

  /**
   * 显示提示
   */
  function showToast(message: string, type: 'success' | 'error' | 'warning', duration = 3000) {
    const toast = document.getElementById('wechatsync-toast')!
    toast.textContent = message
    toast.className = `wechatsync-toast show ${type}`

    setTimeout(() => {
      toast.classList.remove('show')
    }, duration)
  }

  /**
   * 渲染同步结果（带草稿链接）
   */
  function renderResults() {
    if (state.results.length === 0) {
      resultsContainer.style.display = 'none'
      platformsContainer.style.display = 'block'
      panelHeader.textContent = '选择同步平台'
      return
    }

    // 切换到结果视图
    panelHeader.textContent = '同步结果'
    platformsContainer.style.display = 'none'
    resultsContainer.style.display = 'block'

    resultsContainer.innerHTML = state.results.map(r => {
      const platform = state.platforms.find(p => p.id === r.platform)
      const statusClass = r.success ? 'success' : 'error'
      const statusText = r.success ? '✓ 已同步' : '✗ 失败'

      let linkHtml = ''
      if (r.success && r.postUrl) {
        linkHtml = `<a href="${r.postUrl}" target="_blank">编辑草稿 →</a>`
      } else if (!r.success) {
        linkHtml = `<span class="status error">${r.error || '未知错误'}</span>`
      }

      return `
        <div class="wechatsync-result-item ${statusClass}">
          <img src="${platform?.icon || ''}" alt="${platform?.name || r.platform}" onerror="this.style.display='none'">
          <span class="name">${platform?.name || r.platform}</span>
          <span class="status ${statusClass}">${statusText}</span>
          ${linkHtml}
        </div>
      `
    }).join('')

    // 添加"继续同步"按钮
    syncBtn.textContent = '继续同步其他平台'
    syncBtn.disabled = false
    syncBtn.onclick = () => {
      // 切换回平台选择视图
      state.results = []
      resultsContainer.style.display = 'none'
      platformsContainer.style.display = 'block'
      panelHeader.textContent = '选择同步平台'
      mainBtn.classList.remove('success', 'error')
      loadPlatforms()
    }
  }
}

/**
 * 提取微信公众号文章
 */
function extractWeixinArticle() {
  const title = document.querySelector('#activity-name')?.textContent?.trim()
  const contentEl = document.querySelector('#js_content')
  const cover = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
  const summary = document.querySelector('meta[property="og:description"]')?.getAttribute('content')

  if (!title || !contentEl) {
    return null
  }

  // 克隆内容元素，处理懒加载图片
  const clonedContent = contentEl.cloneNode(true) as HTMLElement
  processLazyImages(clonedContent)

  return {
    title,
    html: clonedContent.innerHTML,
    content: clonedContent.innerHTML,
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
 */
function processLazyImages(container: HTMLElement) {
  const images = container.querySelectorAll('img')

  images.forEach((img) => {
    const realSrc =
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-actualsrc') ||
      img.getAttribute('_src') ||
      img.src

    if (realSrc && !realSrc.startsWith('data:image/svg')) {
      img.setAttribute('src', realSrc)
    }

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

// 页面加载完成后注入
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectSyncButton)
} else {
  injectSyncButton()
}
})()
