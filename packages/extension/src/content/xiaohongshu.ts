/**
 * 小红书创作者页面 Content Script
 * 检测同步完成参数，显示提示 Toast
 */

function showSyncedToast() {
  // 检查 URL 参数
  const urlParams = new URLSearchParams(window.location.search)
  if (!urlParams.has('_s')) {
    return
  }

  // 清除 URL 参数（避免刷新后重复显示）
  urlParams.delete('_s')
  const newUrl = `${window.location.pathname}?${urlParams.toString()}`
  window.history.replaceState({}, '', newUrl)

  // 等待页面渲染后显示 Toast
  setTimeout(() => {
    // 创建提示元素
    const toast = document.createElement('div')
    toast.innerHTML = '✅ 草稿已保存，请到「<b>草稿箱 → 长文笔记</b>」查看'
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99999;
      padding: 16px 24px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      border-radius: 12px;
      font-size: 14px;
      box-shadow: 0 4px 20px rgba(16, 185, 129, 0.4);
      animation: wechatsync-slideIn 0.3s ease-out;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `

    // 添加动画样式
    const style = document.createElement('style')
    style.textContent = `
      @keyframes wechatsync-slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes wechatsync-slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
    `
    document.head.appendChild(style)
    document.body.appendChild(toast)

    // 5秒后自动消失
    setTimeout(() => {
      toast.style.animation = 'wechatsync-slideOut 0.3s ease-in forwards'
      setTimeout(() => {
        toast.remove()
        style.remove()
      }, 300)
    }, 5000)
  }, 1000)
}

// 页面加载完成后执行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', showSyncedToast)
} else {
  showSyncedToast()
}
