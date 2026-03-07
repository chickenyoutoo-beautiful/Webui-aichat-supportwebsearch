# NAUJTRATS AI Chat Assistant - Code Documentation & User Guide

## 1. Project Overview
NAUJTRATS AI Chat Assistant is a web-based intelligent conversation application supporting advanced features like file uploads, web search, context compression, and more. The application adopts a modular design with excellent extensibility and user experience.

**Key Features**
- Multi-model support: Compatible with various models using OpenAI API format
- File processing: Supports text, Word, Excel, and multiple other file formats
- Web search: Integrated DuckDuckGo, Brave, Google, and other search engines
- Intelligent judgment: AI automatically determines if web search is needed
- Context management: Automatically compresses long conversation history
- Responsive design: Adapts to desktop and mobile devices
- Dark mode: Supports theme switching
- Real-time streaming: Supports thinking process display

## 2. Code Structure
### 2.1 Global Configuration
```javascript
// Global constants
const MOBILE_BREAKPOINT = 786;          // Mobile breakpoint
const MAX_FILE_SIZE = 10 * 1024 * 1024; // File size limit: 10MB
const SEARCH_PROXY = 'https://search.naujtrats.xyz'; // Search proxy
const ENCRYPTION_KEY = 'naujtrats-secret'; // Encryption key

// Default configuration
const DEFAULT_CONFIG = {
    key: '',                            // API Key
    url: 'https://oneapi.naujtrats.xyz/v1', // API endpoint
    model: 'deepseek-chat',             // Default model
    system: 'You are a helpful assistant...', // System prompt
    // ... other configuration items
};
```

### 2.2 Core Modules
1. **Utility Functions**
   - Encryption/Decryption: `encrypt()`, `decrypt()` - Local storage encryption
   - Token estimation: `estimateTokens()` - Estimates text token count
   - File processing: `extractFileContent()` - Parses multiple file formats
   - Debounce/Throttle: `debounce()`, `throttle()` - Performance optimization

2. **UI Management**
   - Responsive layout: `isMobile()`, `handleResize()` - Adaptive screen
   - Theme switching: `toggleDarkMode()` - Dark/light mode
   - Message rendering: `appendMessage()` - Renders chat messages
   - File preview: `updateFilePreviewUI()` - Displays uploaded files

3. **Configuration Management**
   - Configuration saving: `saveConfig()` - Saves user settings to localStorage
   - Model management: `fetchModels()` - Fetches available model list
   - Search configuration: `createSearchConfigSection()` - Web search settings UI

4. **Web Search Module**
   - Search judgment: `aiShouldSearch()` - AI determines if search is needed
   - Search execution: `performWebSearch()` - Executes actual search
   - Result optimization: `optimizeSearchResults()` - AI optimizes search results
   - Search type judgment: `aiChooseSearchType()` - Determines search type (web/news/image)

5. **Message Processing Core**
   - Message sending: `sendMessage()` - Handles user message sending
   - Streaming response: `streamResponse()` - Handles streaming responses
   - Context compression: `compressContextIfNeeded()` - Automatically compresses long conversations
   - Title generation: `autoGenerateTitle()` - Automatically generates conversation titles

6. **Conversation Management**
   - Conversation creation: `createNewChat()` - Creates new conversation
   - Conversation loading: `loadChat()` - Loads historical conversations
   - Conversation deletion: `deleteChat()` - Deletes conversations
   - History management: `renderChatHistory()` - Renders sidebar history list

## 3. User Guide
### 3.1 Quick Start
1. **Basic Configuration**
   - Open the application, click the settings button (⚙️) in the top-right corner
   - In the configuration panel, enter:
     - API Key: Your OpenAI API key or compatible API key
     - Base URL: API endpoint address (default: `https://oneapi.naujtrats.xyz/v1`)
     - Model Selection: Choose the AI model to use
   - Click "Refresh Models" to load available model list

2. **Start Conversation**
   - Enter your question in the bottom input box
   - Press Enter to send, or click the send button (↗️)
   - AI will start responding with streaming display

### 3.2 File Upload Feature
**Supported File Formats:**
- Text files: `.txt`, `.md`, `.js`, `.py`, `.json`, `.html`, `.css`, etc.
- Office documents: `.docx` (Word), `.xlsx`, `.xls` (Excel)
- Others: `.xml`, `.csv`, `.log`, `.sh`, `.bat`, etc.

**Usage:**
- Click the "📎" icon next to the input box to select files
- Or drag and drop files directly into the input area
- After file parsing completes, it will display above the input box
- File content is automatically attached when sending messages

### 3.3 Web Search Feature
**Enable Search:**
- Find the "Enable Web Search" switch in the configuration panel
- After enabling, you can configure:
  - Search engine: DuckDuckGo, Brave, Google
  - API Key: Required for some search engines
  - Search type: Web, News, Images
  - AI intelligent judgment: Let AI determine if search is needed

**Search Commands:**
- `/search [keywords]` - Force web search
- `/news [keywords]` - Force news search
- `/image [keywords]` - Force image search

**Intelligent Judgment Rules:**
AI automatically determines if search is needed based on keywords:
- Time-related: today, now, latest, real-time
- Information queries: what is, how, why, how to
- Search intent: search, find, query, look up

### 3.4 Advanced Features
1. **Context Compression**
   - Automatically compresses when conversation history becomes too long:
   - Trigger condition: Non-system messages exceed threshold (default: 10)
   - Compression method: AI automatically summarizes early conversation content
   - Configuration location: "Enable Context Compression" in settings panel

2. **Automatic Title Generation**
   - New conversations automatically generate titles based on first few messages
   - Title model can be configured separately
   - Supports typewriter effect display

3. **Message Operations**
   - Copy: Click the copy button at the bottom-right of messages
   - Edit: Click the edit button on user messages to resend
   - Regenerate: Click the regenerate button on AI messages

4. **Response Speed Control**
   - Thinking delay: Controls display speed of AI thinking process
   - Content delay: Controls display speed of reply content
   - Timeout settings: Sets request timeout duration

### 3.5 Interface Operations
**Sidebar Operations:**
- Desktop: Hover mouse on left side to show conversation history
- Mobile: Click menu button in top-left corner to expand sidebar
- Conversation management: Click conversation titles to switch, click "×" to delete

**Configuration Panel:**
- Desktop: Fixed panel on the right side
- Mobile: Slides out from the right side
- Quick settings: Search button next to input box quickly toggles search function

**Theme Switching:**
- Click moon/sun icon in top-right corner to switch dark/light mode
- Theme preferences are automatically saved

### 3.6 Keyboard Shortcuts
- `Enter`: Send message (without Shift)
- `Shift + Enter`: New line
- `Esc`: Stop generation (when AI is responding)

### 3.7 Mobile Adaptation
**Special Features:**
- Virtual keyboard handling: Automatically adjusts layout during input
- Gesture support: Side swipe opens sidebar/settings panel
- Touch optimization: Buttons and interactive elements adapted for touch

**Layout Adjustments:**
- Automatically switches to mobile layout when screen width ≤ 786px
- Conversation history and settings panels become sliding drawers
- Input area automatically adapts to keyboard popup

## 4. Configuration Details
### 4.1 System Prompt Configuration
Default system prompt includes important function descriptions:
- Knowledge base cutoff date reminder
- Web search trigger conditions
- Time context processing rules
- User time baseline settings

### 4.2 Model Parameter Configuration
- Temperature: Controls response randomness (0-2)
- Max tokens: Controls response length
- Streaming response: Enable/disable streaming display
- Custom parameters: Additional API parameters in JSON format

### 4.3 Display Settings
- Font size: Adjustable 12-24px
- Line height: Controls message line spacing
- Paragraph spacing: Controls paragraph spacing
- Paragraph prefix: Optional bullet, dash, or none
- Markdown rendering: GFM support and line break handling

### 4.4 Search Optimization Configuration
- Search result optimization: AI automatically optimizes and summarizes search results
- Max results: Adjustable 1-10 items
- Search timeout: Adjustable 5-120 seconds
- Search region: Specifies search area (e.g., cn, us)

## 5. Technical Implementation Details
### 5.1 Data Storage
- Local storage: Uses localStorage for configuration and conversations
- Encrypted storage: Sensitive information like API Keys are encrypted
- Storage cleanup: Automatically cleans old conversations to prevent overflow

### 5.2 Error Handling
- Network errors: Friendly error prompts and retry suggestions
- API errors: Detailed HTTP status codes and error messages
- File errors: File size and format restriction prompts
- Timeout handling: Configurable timeout durations and automatic cancellation

### 5.3 Performance Optimization
- Lazy loading: On-demand loading of third-party libraries
- Debounce/throttle: Optimized scroll and resize events
- Virtual scrolling: Performance optimization for long message lists
- Cache strategy: Model list and configuration caching

### 5.4 Security
- Local encryption: Client-side encryption of sensitive information
- Input sanitization: HTML escaping prevents XSS
- File restrictions: Size and type limitations
- API security: Keys not sent to third parties (except API providers)

## 6. Troubleshooting
**Common Issues:**
1. **API Connection Failure**
   - Check if API Key is correct
   - Verify if Base URL is accessible
   - Check network connection and firewall settings

2. **File Upload Failure**
   - Confirm file size ≤ 10MB
   - Check if file format is supported
   - Try reselecting the file

3. **Search Function Abnormal**
   - Confirm web search is enabled
   - Check search engine API Key (if required)
   - Verify network connection is normal

4. **Slow Response Speed**
   - Adjust thinking delay and content delay settings
   - Check network latency
   - Try changing model or API endpoint

5. **Insufficient Storage Space**
   - System automatically cleans old conversations
   - Manually delete unnecessary conversation history
   - Clear localStorage in browser settings

**Debug Mode:**
Enter `logDebug()` related parameters in console to view detailed debug information.

## 7. Extension Development
### 7.1 Adding New Features
- Add configuration items in `DEFAULT_CONFIG`
- Handle configuration in `saveConfig()` and `initializeConfig()`
- Add corresponding control elements in UI
- Implement feature logic

### 7.2 Custom Styling
- Control theme colors through CSS variables
- Modify styles in `injectStyles()`
- Adjust responsive breakpoints and layouts

### 7.3 Integrating New Models
- Ensure model compatibility with OpenAI API format
- Add options in model selector
- Adjust request parameters as needed

### 7.4 Adding New File Formats
- Add processing logic in `extractFileContent()`
- Introduce corresponding parsing libraries
- Update file type detection logic

## 8. Version Information
**Current Version:** v16.5

**Major Updates:**
- On-demand time injection mechanism
- Enhanced search judgment
- AI intelligent search type selection
- Hidden thinking process feature
- Mobile input optimization

**Dependencies:**
- marked: Markdown parsing
- highlight.js: Code highlighting
- mammoth: Word document parsing
- SheetJS: Excel file parsing

## 9. Important Notes
- **Privacy Protection:** Conversation content stored locally in browser; avoid using sensitive information on public devices
- **API Costs:** Using third-party APIs may incur charges; monitor usage
- **File Security:** Uploaded files processed locally only, not uploaded to servers
- **Web Search:** Search results from public web; judge information accuracy independently
- **Compatibility:** Recommended modern browsers: Chrome, Firefox, Safari

## 10. Technical Support
For issues or suggestions:
- Check console error messages
- View local storage data status
- Try clearing cache and reloading
- Contact developer for support

**Last Updated:** 2026  
**Document Version:** 1.0  
**Applicable Version:** main.js v16.5+

*Note: This document is generated based on code analysis. Actual features subject to latest code.*
