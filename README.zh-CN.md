# WebUI AI Chat with Web Search

一个功能丰富的 AI 聊天 Web 界面，支持联网搜索、文件上传、上下文压缩和深度思考显示。

## 🌟 主要特性

### 🤖 AI 聊天功能
- 支持多种 AI 模型（兼容 OpenAI API）
- 流式响应，打字机效果
- 支持深度思考过程显示
- 上下文智能压缩
- 对话历史管理

### 🔍 联网搜索
- **智能搜索判断**：AI 自动判断是否需要联网搜索
- **多搜索引擎支持**：
  - DuckDuckGo
  - Brave Search
  - Google Custom Search
- **搜索类型**：网页、新闻、图片搜索
- **搜索结果优化**：AI 自动整理和优化搜索结果
- **搜索命令**：
  - `/search [关键词]` - 强制网页搜索
  - `/news [关键词]` - 新闻搜索
  - `/image [关键词]` - 图片搜索

### 📁 文件处理
- **支持格式**：
  - 文本文件：txt, md, js, py, html, css 等
  - Office 文档：docx, xlsx, xls
  - 配置文件：json, xml, csv, ini
- **文件预览**：上传前显示文件信息
- **内容提取**：自动解析文件内容供 AI 分析

### 🎨 界面特性
- **响应式设计**：完美适配桌面和移动端
- **深色/浅色模式**：一键切换
- **可定制样式**：
  - 字体大小调整
  - 行高设置
  - 段落间距
  - Markdown 渲染选项
- **代码高亮**：支持多种编程语言语法高亮
- **图片预览**：自动识别并预览图片链接

### ⚙️ 高级功能
- **上下文压缩**：自动压缩长对话历史
- **自动标题生成**：AI 自动为对话生成标题
- **消息操作**：
  - 复制消息内容
  - 编辑用户消息
  - 重新生成 AI 回复
- **代理支持**：可配置代理服务器
- **自定义参数**：支持 API 调用自定义参数

## 🚀 快速开始

### 1. 环境要求
- 现代浏览器（Chrome 90+, Firefox 88+, Safari 14+）
- 支持 JavaScript 和 WebSocket
- 可选的：OneAPI 或 OpenAI API 密钥

### 2. 部署方式

#### 方式一：直接使用（推荐）
1. 下载项目文件
2. 上传到 Web 服务器（Apache/Nginx）
3. 访问 `index.html`

#### 方式二：Docker 部署
```bash
# 构建镜像
docker build -t webui-aichat .

# 运行容器
docker run -d -p 8080:80 --name aichat webui-aichat
```

#### 方式三：本地开发
```bash
# 克隆项目
git clone https://github.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch.git

# 进入目录
cd Webui-aichat-supportwebsearch

# 使用 Python 简单服务器
python3 -m http.server 8000

# 或使用 Node.js
npx serve .
```

### 3. 配置说明

#### API 配置
1. 打开网页后，点击右上角设置图标
2. 配置以下参数：
   - **API Key**：你的 OneAPI 或 OpenAI API 密钥
   - **API URL**：API 端点地址（默认：`https://oneapi.naujtrats.xyz/v1`）
   - **模型**：选择要使用的 AI 模型

#### 搜索配置
1. 在设置面板中启用"联网搜索"
2. 配置搜索引擎和 API 密钥
3. 可选：启用 AI 智能判断

## 📖 使用指南

### 基本聊天
1. 在底部输入框输入问题
2. 按 Enter 发送，Shift+Enter 换行
3. AI 会流式回复，显示思考过程

### 文件上传
1. 点击附件图标或拖拽文件到输入区域
2. 支持多文件同时上传
3. AI 会自动分析文件内容

### 联网搜索
1. 启用搜索功能后，AI 会自动判断是否需要搜索
2. 或使用命令强制搜索：
   ```
   /search 最新科技新闻
   /news 今日头条
   /image 可爱猫咪
   ```

### 对话管理
- **新建对话**：点击侧边栏"+"按钮
- **切换对话**：点击侧边栏历史记录
- **删除对话**：鼠标悬停对话项，点击删除图标
- **导出对话**：复制消息内容或使用浏览器开发者工具

## 🔧 技术架构

### 前端技术栈
- **核心**：原生 JavaScript (ES6+)
- **UI 框架**：Tailwind CSS
- **Markdown 渲染**：Marked.js
- **代码高亮**：Highlight.js
- **文件处理**：
  - Mammoth.js (Word 文档)
  - SheetJS (Excel 文档)
- **图标**：SVG 图标

### 项目结构
```
Webui-aichat-supportwebsearch/
├── index.html          # 主页面
├── main.js            # 核心逻辑（v16.5）
├── style.css          # 样式文件
├── lib/               # 第三方库
│   ├── marked.min.js
│   ├── highlight.min.js
│   ├── mammoth.browser.min.js
│   ├── xlsx.full.min.js
│   └── atom-one-light.min.css
└── README.md          # 本文件
```

### 数据存储
- **本地存储**：使用 localStorage 保存配置和对话
- **加密存储**：API 密钥等敏感信息加密存储
- **自动清理**：定期清理旧对话防止存储溢出

## ⚡ 性能优化

### 加载优化
- 按需加载第三方库
- 资源缓存策略
- 懒加载图片

### 响应优化
- 防抖和节流处理
- 虚拟滚动（计划中）
- 请求超时控制

### 存储优化
- 自动上下文压缩
- 大文件处理限制
- 存储空间监控

## 🔒 安全特性

### 数据安全
- API 密钥本地加密存储
- 不记录用户对话到远程服务器
- 所有数据处理在客户端完成

### 隐私保护
- 无用户跟踪
- 可配置搜索代理
- 支持私有部署

## 🌐 网络配置

### 代理设置
项目支持通过代理服务器访问：
```javascript
// 在 main.js 中配置
const SEARCH_PROXY = 'https://your-proxy-server.com';
```

### CORS 处理
- 需要 API 服务器支持 CORS
- 或通过代理服务器中转

## 📱 移动端支持

### 适配特性
- 触摸友好的界面
- 虚拟键盘处理
- 手势操作支持
- 响应式布局

### PWA 支持（计划中）
- 离线访问
- 添加到主屏幕
- 推送通知

## 🛠️ 开发指南

### 代码结构
```javascript
// 主要模块
- 配置管理
- 消息处理
- 文件处理
- 搜索功能
- UI 组件
- 工具函数
```

### 扩展开发
1. **添加新功能**：在相应模块中添加代码
2. **修改样式**：编辑 `style.css` 或内联样式
3. **集成新 API**：修改 API 调用逻辑

### 调试工具
- 内置调试日志
- 网络请求监控
- 存储状态检查

## 📊 版本历史

### v16.5 (当前)
- 按需时间注入优化
- 搜索判断强化
- 性能改进
- Bug 修复

### v16.0
- 重构核心架构
- 添加文件处理
- 增强搜索功能
- 改进 UI/UX

### v15.0
- 初始版本发布
- 基础聊天功能
- 简单搜索支持

## 🤝 贡献指南

### 报告问题
1. 在 Issues 页面创建新问题
2. 描述详细的重现步骤
3. 提供浏览器和系统信息

### 提交代码
1. Fork 项目
2. 创建功能分支
3. 提交 Pull Request
4. 确保代码通过测试

### 开发规范
- 使用 ESLint 规范代码
- 添加必要的注释
- 更新相关文档

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- 感谢所有贡献者和用户
- 感谢开源社区提供的优秀库
- 特别感谢 AI 模型提供方

## 📞 支持与反馈

### 问题反馈
- GitHub Issues: [问题反馈](https://github.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch/issues)
- 邮箱: xyq070519@gmail.com

### 文档资源
- [使用教程](./docs/DOCUMENTATION.zh-CN.md)
- [API 文档](docs/api.md)（计划中）
- [常见问题](docs/faq.md)（计划中）

---

**✨ 提示**：本项目持续开发中，欢迎提出建议和贡献代码！

**🚀 立即开始**：访问 [在线演示](https://naujtrats.xyz/oneapichat/index.html) 或部署你自己的实例！
```
