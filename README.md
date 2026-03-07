<!-- 这个文件会被 GitHub 优先显示 -->
请查看以下语言版本：
- [English](./README.md)
- [中文](./README.zh-CN.md)


# WebUI AI Chat with Web Search

A feature-rich AI chat web interface with web search, file upload, context compression, and deep thinking display.

## 🌟 Key Features

### 🤖 AI Chat Capabilities
- Support for multiple AI models (OpenAI API compatible)
- Streaming responses with typewriter effect
- Deep thinking process display
- Intelligent context compression
- Conversation history management

### 🔍 Web Search Integration
- **Smart Search Judgment**: AI automatically determines if web search is needed
- **Multiple Search Engines**:
  - DuckDuckGo
  - Brave Search
  - Google Custom Search
- **Search Types**: Web, News, Image search
- **Search Result Optimization**: AI automatically organizes and optimizes search results
- **Search Commands**:
  - `/search [keywords]` - Force web search
  - `/news [keywords]` - News search
  - `/image [keywords]` - Image search

### 📁 File Processing
- **Supported Formats**:
  - Text files: txt, md, js, py, html, css, etc.
  - Office documents: docx, xlsx, xls
  - Configuration files: json, xml, csv, ini
- **File Preview**: Display file information before upload
- **Content Extraction**: Automatically parse file content for AI analysis

### 🎨 UI Features
- **Responsive Design**: Perfect for desktop and mobile
- **Dark/Light Mode**: One-click theme switching
- **Customizable Styles**:
  - Font size adjustment
  - Line height settings
  - Paragraph spacing
  - Markdown rendering options
- **Syntax Highlighting**: Support for multiple programming languages
- **Image Preview**: Automatically recognize and preview image links

### ⚙️ Advanced Features
- **Context Compression**: Automatically compress long conversation history
- **Auto Title Generation**: AI automatically generates titles for conversations
- **Message Operations**:
  - Copy message content
  - Edit user messages
  - Regenerate AI responses
- **Proxy Support**: Configurable proxy server
- **Custom Parameters**: Support for custom API call parameters

## 🚀 Quick Start

### 1. Requirements
- Modern browser (Chrome 90+, Firefox 88+, Safari 14+)
- JavaScript and WebSocket support
- Optional: OneAPI or OpenAI API key

### 2. Deployment Methods

#### Method 1: Direct Use (Recommended)
1. Download project files
2. Upload to web server (Apache/Nginx)
3. Access `index.html`

#### Method 2: Docker Deployment
```bash
# Build image
docker build -t webui-aichat .

# Run container
docker run -d -p 8080:80 --name aichat webui-aichat
```

#### Method 3: Local Development
```bash
# Clone project
git clone https://github.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch.git

# Enter directory
cd Webui-aichat-supportwebsearch

# Use Python simple server
python3 -m http.server 8000

# Or use Node.js
npx serve .
```

### 3. Configuration Guide

#### API Configuration
1. Open the webpage and click the settings icon in the top right
2. Configure the following parameters:
   - **API Key**: Your OneAPI or OpenAI API key
   - **API URL**: API endpoint address (default: `https://oneapi.naujtrats.xyz/v1`)
   - **Model**: Select the AI model to use

#### Search Configuration
1. Enable "Web Search" in settings panel
2. Configure search engine and API key
3. Optional: Enable AI smart judgment

## 📖 User Guide

### Basic Chat
1. Enter your question in the bottom input box
2. Press Enter to send, Shift+Enter for new line
3. AI will respond with streaming, showing thinking process

### File Upload
1. Click attachment icon or drag files to input area
2. Support multiple file uploads simultaneously
3. AI will automatically analyze file content

### Web Search
1. After enabling search, AI automatically determines if search is needed
2. Or use commands to force search:
   ```
   /search latest tech news
   /news today's headlines
   /image cute cats
   ```

### Conversation Management
- **New Conversation**: Click "+" button in sidebar
- **Switch Conversation**: Click history items in sidebar
- **Delete Conversation**: Hover over conversation item, click delete icon
- **Export Conversation**: Copy message content or use browser developer tools

## 🔧 Technical Architecture

### Frontend Tech Stack
- **Core**: Native JavaScript (ES6+)
- **UI Framework**: Tailwind CSS
- **Markdown Rendering**: Marked.js
- **Syntax Highlighting**: Highlight.js
- **File Processing**:
  - Mammoth.js (Word documents)
  - SheetJS (Excel documents)
- **Icons**: SVG icons

### Project Structure
```
Webui-aichat-supportwebsearch/
├── index.html          # Main page
├── main.js            # Core logic (v16.5)
├── style.css          # Stylesheet
├── lib/               # Third-party libraries
│   ├── marked.min.js
│   ├── highlight.min.js
│   ├── mammoth.browser.min.js
│   ├── xlsx.full.min.js
│   └── atom-one-light.min.css
└── README.md          # This file
```

### Data Storage
- **Local Storage**: Use localStorage for configuration and conversations
- **Encrypted Storage**: Sensitive information like API keys are encrypted
- **Auto Cleanup**: Regularly clean old conversations to prevent storage overflow

## ⚡ Performance Optimization

### Loading Optimization
- On-demand loading of third-party libraries
- Resource caching strategy
- Lazy loading of images

### Response Optimization
- Debounce and throttle handling
- Virtual scrolling (planned)
- Request timeout control

### Storage Optimization
- Automatic context compression
- Large file handling limits
- Storage space monitoring

## 🔒 Security Features

### Data Security
- API keys locally encrypted
- No user conversation logging to remote servers
- All data processing done client-side

### Privacy Protection
- No user tracking
- Configurable search proxy
- Support for private deployment

## 🌐 Network Configuration

### Proxy Settings
Project supports access through proxy servers:
```javascript
// Configure in main.js
const SEARCH_PROXY = 'https://your-proxy-server.com';
```

### CORS Handling
- Requires API server to support CORS
- Or use proxy server for forwarding

## 📱 Mobile Support

### Adaptive Features
- Touch-friendly interface
- Virtual keyboard handling
- Gesture operation support
- Responsive layout

### PWA Support (Planned)
- Offline access
- Add to home screen
- Push notifications

## 🛠️ Development Guide

### Code Structure
```javascript
// Main modules
- Configuration management
- Message handling
- File processing
- Search functionality
- UI components
- Utility functions
```

### Extension Development
1. **Add new features**: Add code in corresponding modules
2. **Modify styles**: Edit `style.css` or inline styles
3. **Integrate new APIs**: Modify API calling logic

### Debugging Tools
- Built-in debug logging
- Network request monitoring
- Storage status checking

## 📊 Version History

### v16.5 (Current)
- Optimized on-demand time injection
- Enhanced search judgment
- Performance improvements
- Bug fixes

### v16.0
- Refactored core architecture
- Added file processing
- Enhanced search functionality
- Improved UI/UX

### v15.0
- Initial version release
- Basic chat functionality
- Simple search support

## 🤝 Contribution Guide

### Reporting Issues
1. Create new issue on Issues page
2. Describe detailed reproduction steps
3. Provide browser and system information

### Submitting Code
1. Fork the project
2. Create feature branch
3. Submit Pull Request
4. Ensure code passes tests

### Development Standards
- Use ESLint for code standardization
- Add necessary comments
- Update relevant documentation

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Thanks to all contributors and users
- Thanks to the open-source community for excellent libraries
- Special thanks to AI model providers

## 📞 Support & Feedback

### Issue Reporting
- GitHub Issues: [Issue Reporting](https://github.com/chickenyoutoo-beautiful/Webui-aichat-supportwebsearch/issues)
- Email: xyq070519@gmail.com

### Documentation Resources
- [Tutorial](./docs/DOCUMENTATION.md)
- [API Documentation](docs/api.md) (Planned)
- [FAQ](docs/faq.md) (Planned)

---

**✨ Tip**: This project is under continuous development, suggestions and contributions are welcome!

**🚀 Get Started Now**: Visit [Live Demo](https://naujtrats.xyz/oneapichat/index.html) or deploy your own instance!
```
