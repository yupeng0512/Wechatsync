---
name: wechatsync
description: 同步文章到多个内容平台（知乎、掘金、CSDN、头条、微博等）。当用户想要发布或同步文章到内容平台时使用。
---

# WechatSync

同步文章到多个内容平台（知乎、掘金、CSDN、头条、微博等 20+ 平台）。

## 前置条件

1. 安装 CLI: `npm install -g @wechatsync/cli`
2. 安装 Chrome 扩展: https://www.wechatsync.com/#install
3. 在扩展设置中启用 MCP 连接，获取 Token
4. 设置环境变量: `export WECHATSYNC_TOKEN="你的token"`
5. 在各平台登录账号

## 命令

### 同步文章

```bash
# 同步到单个平台
wechatsync sync article.md -p juejin

# 同步到多个平台
wechatsync sync article.md -p juejin,zhihu,csdn

# 指定标题
wechatsync sync article.md -p juejin -t "我的文章标题"

# 添加封面图
wechatsync sync article.md -p juejin --cover ./cover.png

# 预览（不实际同步）
wechatsync sync article.md -p juejin --dry-run
```

### 查看平台

```bash
# 列出所有平台
wechatsync platforms

# 显示登录状态
wechatsync platforms --auth
```

### 检查登录状态

```bash
# 检查所有平台
wechatsync auth

# 检查单个平台
wechatsync auth zhihu
```

### 提取文章

```bash
# 从浏览器当前页面提取
wechatsync extract

# 保存到文件
wechatsync extract -o article.md
```

## 支持的平台

zhihu, juejin, jianshu, toutiao, weibo, bilibili, baijiahao, csdn, yuque, douban, sohu, xueqiu, weixin, woshipm, dayu, yidian, 51cto, sohufocus, imooc, oschina, segmentfault, cnblogs, x, xiaohongshu

## 图片处理

- 本地图片自动上传到第一个目标平台的图床
- 其他平台会自动转存图片
- 支持格式: PNG, JPG, GIF, WebP, SVG

## 文章格式

支持 Markdown 和 HTML 文件。Markdown 文件标题从以下位置提取：
1. YAML front matter 的 `title` 字段
2. 第一个 `# 标题`

## 示例

用户: "把这篇文章同步到掘金和知乎"
操作:
1. 先用 `wechatsync platforms --auth` 检查登录状态
2. 用 `wechatsync sync <文件路径> -p juejin,zhihu` 同步

用户: "帮我看看哪些平台已登录"
操作: `wechatsync platforms --auth`

用户: "从浏览器提取当前文章保存下来"
操作: `wechatsync extract -o article.md`
