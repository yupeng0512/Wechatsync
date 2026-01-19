# 文章同步助手

![](https://img.shields.io/github/v/release/wechatsync/Wechatsync.svg)
![](https://img.shields.io/github/last-commit/wechatsync/Wechatsync)
![](https://img.shields.io/github/issues/wechatsync/Wechatsync)

一键同步文章到知乎、头条、掘金、小红书等 25+ 平台，支持 WordPress 等自建站。

## 功能特性

- **多平台同步**: 支持知乎、掘金、头条、CSDN、简书、微博、小红书等 25+ 平台
- **自建站支持**: WordPress、Typecho、MetaWeblog API
- **智能提取**: 自动从网页提取文章标题、内容、封面图（基于 Safari 阅读模式）
- **图片上传**: 自动上传文章图片到目标平台
- **草稿模式**: 同步后保存为草稿，方便二次编辑
- **MCP 集成**: 支持 Claude Code 通过 MCP 协议调用

## 安装方式

### Chrome 商店安装

[Chrome 网上应用店](https://chrome.google.com/webstore/detail/%E5%BE%AE%E4%BF%A1%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B/hchobocdmclopcbnibdnoafilagadion)


## 支持的平台

| 平台 | ID | 类型 | 状态 |
|-----|-----|-----|-----|
| 微信公众号 | weixin | 主流自媒体 | ✅ |
| 知乎 | zhihu | 主流自媒体 | ✅ |
| 微博 | weibo | 主流自媒体 | ✅ |
| 掘金 | juejin | 技术社区 | ✅ |
| CSDN | csdn | 技术社区 | ✅ |
| 简书 | jianshu | 通用 | ✅ |
| 头条号 | toutiao | 通用 | ✅ |
| B站专栏 | bilibili | 通用 | ✅ |
| 百家号 | baijiahao | 通用 | ✅ |
| 语雀 | yuque | 技术社区 | ✅ |
| 豆瓣 | douban | 通用 | ✅ |
| 搜狐号 | sohu | 通用 | ✅ |
| 雪球 | xueqiu | 财经 | ✅ |
| 人人都是产品经理 | woshipm | 产品 | ✅ |
| 大鱼号 | dayu | 通用 | ✅ |
| 一点号 | yidian | 通用 | ✅ |
| 51CTO | 51cto | 技术社区 | ✅ |
| 慕课网 | imooc | 技术社区 | ✅ |
| 开源中国 | oschina | 技术社区 | ✅ |
| SegmentFault | segmentfault | 技术社区 | ✅ |
| 搜狐焦点 | sohufocus | 房产 | ✅ |
| 小红书 | xiaohongshu | 主流自媒体 | ✅ |
| X (Twitter) | x | 海外 | ✅ |
| WordPress | wordpress | 自建站 | ✅ |
| Typecho | typecho | 自建站 | ✅ |

- [提交新平台请求](https://airtable.com/shrLSJMnTC2BlmP29)

## Claude Code 集成

通过 MCP 协议，可以在 Claude Code 中直接使用文章同步助手。

### 配置步骤

1. 构建项目: `pnpm build`
2. 在 Chrome 扩展设置中启用「MCP 连接」，并设置 Token
3. 在 `~/.claude/claude_desktop_config.json` 中添加配置：

```json
{
  "mcpServers": {
    "sync-assistant": {
      "command": "node",
      "args": ["/path/to/Wechatsync/packages/mcp-server/dist/index.js"],
      "env": {
        "MCP_TOKEN": "your-secret-token-here"
      }
    }
  }
}
```

**重要**: `MCP_TOKEN` 必须与 Chrome 扩展中设置的 Token 一致。

### 使用示例

```
"帮我把这篇文章同步到知乎和掘金"
"检查下哪些平台已登录"
```

### 可用工具

| 工具 | 说明 |
|-----|------|
| `list_platforms` | 列出所有平台及登录状态 |
| `check_auth` | 检查指定平台登录状态 |
| `sync_article` | 同步文章到指定平台（草稿） |
| `extract_article` | 从当前浏览器页面提取文章 |
| `upload_image_file` | 上传本地图片到平台 |

详细文档见 [packages/mcp-server/README.md](packages/mcp-server/README.md)

## 网页发起同步

如果你是文章编辑器开发者，或有内容库需要同步多个渠道，可以使用 JS SDK：

- [article-syncjs](https://github.com/wechatsync/article-syncjs) - 网页端 SDK
- [API 文档](API.md)

```javascript
// 拉起同步任务框
window.syncPost(article)
```

## 开发

### 项目结构

```
Wechatsync/
├── packages/
│   ├── extension/     # Chrome 扩展 (MV3)
│   ├── mcp-server/    # MCP Server (stdio/SSE)
│   └── core/          # 核心逻辑 (共享)
```

### 本地开发

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build
```

然后在 Chrome 中加载 `packages/extension/dist` 目录。

## 贡献代码

欢迎参与项目开发！

- [待支持的平台列表](https://airtable.com/shrLSJMnTC2BlmP29)
- [如何开发一个适配器](docs/adapter-spec.md)
- [API 文档](API.md)

## License

GPL-3.0
