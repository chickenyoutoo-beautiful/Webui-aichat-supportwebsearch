// main.js 优化版 v16.5 (按需时间注入 + 搜索判断强化)
// ==================== 全局常量 ====================
const MOBILE_BREAKPOINT = 786;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const SEARCH_PROXY = 'https://search.naujtrats.xyz';
const ENCRYPTION_KEY = 'naujtrats-secret';

const AI_JUDGE_TIMEOUT = 5000;
const MAX_HISTORY_LENGTH = 2000;
const TITLE_MAX_LENGTH = 20;
const MAX_TOKENS_SAFETY_MARGIN = 1000;
const STREAM_DELAY = 2;

const DEFAULT_CONFIG = {
    key: '', url: 'https://oneapi.naujtrats.xyz/v1', model: 'deepseek-chat',
    system: '你是一个有用的助手。你的知识库有截止日期，对于需要最新信息的问题，你可以通过联网搜索来获取。\n重要设定：\n在对话中，如果用户明确提供了 "当前时间"或类似的上下文时间点（例如："假设现在是2026年"），你将默认以此时间为整个对话的当前时间基准，并基于此时间点来理解所有与时间相关的概念（如"今天"、"本周"、"今年")。\n在此设定下：\n- 对于该时间点之前的历史信息，你可以使用自身知识库。\n- 对于需要获取该时间点之后才产生的实时信息、或用户明确要求连接真实世界"此刻"状态时，你会选择联网搜索。\n请始终优先遵循用户给出的时间上下文。',
    stream: true, compress: false, threshold: 10,
    compressModel: '', reasoningDelay: 25, contentDelay: 12, requestTimeout: 60,
    customParams: '', customEnabled: false, lineHeight: 1.1, paragraphMargin: 0.1,
    paragraphPrefix: 'none', markdownGFM: true, markdownBreaks: true, titleModel: '',
    enableSearch: false, searchModel: '', searchProvider: 'duckduckgo', searchApiKey: '',
    searchTimeout: 30, maxSearchResults: 3, aiSearchJudge: false, aiSearchJudgeModel: '',
    // 强化后的 AI 判断提示词（包含示例和明确规则）
    aiSearchJudgePrompt: '请严格根据以下规则判断是否需要联网搜索，只返回一个单词 true 或 false，不要添加任何解释。\n规则：\n- 如果用户问题涉及当前时间、新闻、实时数据、知识库截止日期后的新事件，返回 true。\n- 如果问题仅需常识、历史知识、数学计算等，返回 false。\n示例：\n用户：今天天气怎么样？ -> true\n用户：法国大革命是哪一年？ -> false\n用户：现在几点了？ -> true\n用户：1+1等于几？ -> false\n用户：帮我查一下最新的iPhone价格 -> true\n用户：李白是哪个朝代的？ -> false',
    enableSearchOptimize: true, fontSize: 16,
    searchType: 'web',
    aiSearchTypeToggle: false,
    searchShowPrompt: true,
    searchAppendToSystem: false,
    hideReasoning: false
};

// ==================== 全局变量 ====================
let keyboardActive = false;
let currentChatId = null;
let chats = JSON.parse(localStorage.getItem('chats') || '{}');
let pendingFiles = [];
let isTypingMap = {};
let abortControllerMap = {};
let searchAbortControllerMap = {};
let activeBubbleMap = {};
let userScrolled = false;
let modelContextLength = JSON.parse(localStorage.getItem('modelContextLength') || '{}');
let lastSentMessage = null;
let prevWidth = window.innerWidth;

const $ = {
    chatBox: null,
    chatMessagesContainer: null,
    userInput: null,
    sendBtn: null,
    stopBtn: null,
    filePreviewContainer: null,
    fileInput: null,
    scrollToBottomBtn: null,
    chatTitle: null,
    sidebar: null,
    configPanel: null,
    sidebarMask: null,
    sidebarToggle: null,
    searchQuickToggle: null
};

// ==================== 工具函数 ====================
const getEl = id => document.getElementById(id);
const getVal = id => getEl(id)?.value;
const getChecked = id => getEl(id)?.checked || false;
const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
const setChecked = (id, val) => { const el = getEl(id); if (el) el.checked = val; };

function logDebug(...args) {
    if (true) console.log('[AI Debug]', ...args);
}

function encrypt(text) {
    if (!text) return text;
    const key = new TextEncoder().encode(ENCRYPTION_KEY);
    const data = new TextEncoder().encode(text);
    const res = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) res[i] = data[i] ^ key[i % key.length];
    return btoa(String.fromCharCode(...res));
}

function decrypt(encoded) {
    if (!encoded) return encoded;
    try {
        const bin = atob(encoded);
        const bytes = new Uint8Array([...bin].map(c => c.charCodeAt(0)));
        const key = new TextEncoder().encode(ENCRYPTION_KEY);
        const res = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) res[i] = bytes[i] ^ key[i % key.length];
        return new TextDecoder().decode(res);
    } catch {
        return encoded;
    }
}

function compressNewlines(text, max = 1) {
    return text ? text.replace(/\r\n/g, '\n').replace(new RegExp(`\n{${max + 1},}`, 'g'), '\n'.repeat(max)) : text;
}

function estimateTokens(text) {
    if (!text) return 0;
    const ch = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const other = text.length - ch;
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.ceil(ch * 2 + other * 0.25 + words * 1.3);
}

const debounce = (fn, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), wait);
    };
};

const throttle = (fn, limit) => {
    let inThrottle;
    return (...args) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function buildUserContent(text, files) {
    if (!files?.length) return text;
    return files.map(f => `[附件: ${f.name}]\n${f.content}`).join('\n\n') + (text ? `\n指令: ${text}` : '');
}

function checkStorageSpace() {
    try {
        localStorage.setItem('_test', 'x'.repeat(1e6));
        localStorage.removeItem('_test');
        return true;
    } catch {
        return false;
    }
}

function cleanupOldChats(keep = 10) {
    const ids = Object.keys(chats).sort((a, b) => (parseInt(a.split('_')[1]) || 0) - (parseInt(b.split('_')[1]) || 0));
    if (ids.length <= keep) return;
    ids.slice(0, ids.length - keep).forEach(id => delete chats[id]);
    saveChats();
}

// ==================== 文件处理 ====================
async function extractFileContent(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (file.type.startsWith('text/') || ['txt', 'md', 'js', 'py', 'json', 'html', 'css', 'xml', 'csv', 'log', 'sh', 'bat', 'conf', 'ini'].includes(ext)) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = e => resolve(e.target.result);
            fr.onerror = reject;
            fr.readAsText(file);
        });
    }
    if (ext === 'docx' || file.type.includes('word')) {
        if (!window.mammoth) throw new Error('mammoth 未加载');
        const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        return value;
    }
    if (['xlsx', 'xls', 'xlsm'].includes(ext) || file.type.includes('spreadsheet')) {
        if (!window.XLSX) throw new Error('SheetJS 未加载');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        return wb.SheetNames.map((name, i) => `【工作表 ${i + 1}: ${name}】\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: '\t', RS: '\n' })).join('\n\n');
    }
    // fallback
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = e => resolve(e.target.result);
        fr.onerror = reject;
        fr.readAsText(file);
    });
}

function updateFilePreviewUI() {
    const container = $.filePreviewContainer;
    if (!container) return;
    container.innerHTML = '';
    if (!pendingFiles.length) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    pendingFiles.forEach((f, i) => {
        const tag = document.createElement('span');
        tag.className = 'file-tag';
        tag.innerHTML = `<svg class="file-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M2 1.5C2 0.67 2.67 0 3.5 0h5.88c.4 0 .78.16 1.06.44l3.12 3.12c.28.28.44.66.44 1.06V14.5c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5v-13zM3.5 1c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h9c.28 0 .5-.22.5-.5V4.62L10.38 1H3.5z"/><path d="M9 1v3.5c0 .28.22.5.5.5H13v1H9.5C8.67 6 8 5.33 8 4.5V1h1z"/></svg> ${escapeHtml(f.name)} (${(f.size / 1024).toFixed(1)}KB) <span class="remove-file" onclick="window.removeFile(${i})">✕</span>`;
        container.appendChild(tag);
    });
}

window.removeFile = i => {
    pendingFiles.splice(i, 1);
    updateFilePreviewUI();
    if ($.fileInput) $.fileInput.value = '';
};

function clearAllFiles() {
    pendingFiles = [];
    updateFilePreviewUI();
    if ($.fileInput) $.fileInput.value = '';
}

async function processSelectedFiles(fileList) {
    for (const file of Array.from(fileList)) {
        if (file.size > MAX_FILE_SIZE) {
            showToast(`文件 ${file.name} 超过10MB`, 'warning');
            continue;
        }
        // 显示解析中提示
        const tempEl = document.createElement('span');
        tempEl.className = 'file-tag';
        tempEl.textContent = `⏳ 解析 ${file.name}...`;
        $.filePreviewContainer?.appendChild(tempEl);

        try {
            const content = await extractFileContent(file);
            pendingFiles.push({ name: file.name, content, size: file.size });
            showToast(`文件 ${file.name} 解析完成`, 'success');
        } catch (err) {
            showToast(`解析 ${file.name} 失败: ${err.message}`, 'error');
        } finally {
            tempEl.remove();
        }
    }
    updateFilePreviewUI();
    if ($.fileInput) $.fileInput.value = '';
}

// ==================== UI 工具 ====================
window.autoResize = function (el) {
    el.style.height = 'auto';
    const max = window.innerWidth <= 480 ? 120 : 150;
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
};

function showToast(msg, type = 'info', dur = 3000) {
    let container = getEl('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${ { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }[type] }</div>
        <div class="toast-message">${escapeHtml(msg)}</div>
        <button class="toast-close">&times;</button>
    `;
    toast.querySelector('.toast-close').onclick = () => toast.remove();
    setTimeout(() => toast.remove(), dur);
    container.appendChild(toast);
}

window.scrollToBottom = () => {
    $.chatBox?.scrollTo({ top: $.chatBox.scrollHeight, behavior: 'smooth' });
    userScrolled = false;
};

window.toggleDarkMode = function (init = false) {
    const html = document.documentElement;
    const dark = html.classList.toggle('dark');
    if (!init) localStorage.setItem('dark', dark);
    const moon = getEl('moonPath');
    const sun = getEl('sunPath');
    moon?.classList.toggle('hidden', dark);
    sun?.classList.toggle('hidden', !dark);
    const theme = getEl('hljsTheme');
    if (theme) theme.href = dark ? 'lib/atom-one-dark.min.css' : 'lib/atom-one-light.min.css';
};

function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
}

window.closeMobileSidebars = () => {
    if (!isMobile()) return;
    $.sidebar?.classList.remove('mobile-open');
    $.configPanel?.classList.remove('mobile-open');
    $.sidebarMask?.classList.remove('active');
};

window.toggleSidebar = () => {
    if (isMobile()) {
        if ($.sidebar?.classList.contains('mobile-open')) {
            $.sidebar.classList.remove('mobile-open');
            $.sidebarMask?.classList.remove('active');
        } else {
            $.sidebar?.classList.add('mobile-open');
            $.configPanel?.classList.remove('mobile-open');
            $.sidebarMask?.classList.add('active');
        }
    } else {
        $.sidebar?.classList.toggle('collapsed');
        if ($.sidebarToggle) $.sidebarToggle.style.display = $.sidebar?.classList.contains('collapsed') ? 'block' : 'none';
    }
};

window.toggleConfigPanel = () => {
    if (isMobile()) {
        if ($.configPanel?.classList.contains('mobile-open')) {
            $.configPanel.classList.remove('mobile-open');
            $.sidebarMask?.classList.remove('active');
        } else {
            $.configPanel?.classList.add('mobile-open');
            $.sidebar?.classList.remove('mobile-open');
            $.sidebarMask?.classList.add('active');
        }
    } else {
        $.configPanel?.classList.toggle('hidden-panel');
    }
};

const handleResize = debounce(() => {
    if (keyboardActive) return;
    const newWidth = window.innerWidth;
    const wasMobile = prevWidth <= MOBILE_BREAKPOINT;
    const nowMobile = newWidth <= MOBILE_BREAKPOINT;
    prevWidth = newWidth;
    if (wasMobile === nowMobile) return;
    if (nowMobile) {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        $.configPanel?.classList.remove('mobile-open', 'hidden-panel');
        $.sidebarMask?.classList.remove('active');
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
    } else {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        $.configPanel?.classList.add('hidden-panel');
        $.sidebarMask?.classList.remove('active');
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
    }
}, 100);

// ==================== 配置管理 ====================
function createTitleModelSelector() {
    if (getEl('titleModel')) return;
    const sidebar = getEl('sidebar');
    const target = sidebar?.querySelector('.mt-6.pt-4');
    if (!target) return;
    const div = document.createElement('div');
    div.className = 'mt-4 pt-4 border-t border-gray-200 dark:border-gray-800 space-y-3';
    div.innerHTML = `
        <h3 class="text-xs font-bold text-gray-400 uppercase">标题生成</h3>
        <div class="flex items-center gap-2 text-xs">
            <span>标题模型:</span>
            <select id="titleModel" class="w-32 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full px-2 py-1 text-xs outline-none">
                <option value="">默认</option>
            </select>
        </div>
    `;
    sidebar.insertBefore(div, target);
    getEl('titleModel')?.addEventListener('change', e => localStorage.setItem('titleModel', e.target.value));
}

function createSearchConfigSection() {
    if (getEl('searchConfigItem')) return;
    const customParamsEl = getEl('customParams');
    const target = customParamsEl?.closest('div');
    if (!target) return;
    const section = document.createElement('div');
    section.id = 'searchConfigItem';
    section.className = 'config-item';
    section.innerHTML = `
        <div class="flex items-center justify-between">
            <label>启用联网搜索</label>
            <label class="switch"><input type="checkbox" id="searchToggle"><span class="slider"></span></label>
        </div>
        <div class="mt-2 space-y-3" id="searchConfigDetails" style="display:none;">
            <div class="flex items-center justify-between">
                <label class="text-xs">AI智能判断是否需要搜索</label>
                <label class="switch small"><input type="checkbox" id="aiSearchJudgeToggle"><span class="slider"></span></label>
            </div>
            <div id="aiSearchJudgeDetails" style="display:none;">
                <div><label class="block text-xs text-gray-500 mb-1">判断模型</label><select id="aiSearchJudgeModel" class="config-input"><option value="">同主模型</option></select></div>
                <div><label class="block text-xs text-gray-500 mb-1">判断提示词</label><textarea id="aiSearchJudgePrompt" rows="3" class="config-input text-xs">${DEFAULT_CONFIG.aiSearchJudgePrompt}</textarea></div>
            </div>
            <div><label class="block text-xs text-gray-500 mb-1">搜索模型</label><select id="searchModel" class="config-input"><option value="">同主模型</option></select></div>
            <div><label class="block text-xs text-gray-500 mb-1">搜索引擎</label><select id="searchProvider" class="config-input"><option value="duckduckgo">DuckDuckGo</option><option value="brave">Brave Search</option><option value="google">Google Custom</option></select></div>
            <div><label class="block text-xs text-gray-500 mb-1">API Key</label><input type="password" id="searchApiKey" class="config-input"></div>
            <div><label class="block text-xs text-gray-500 mb-1">搜索地区</label><input type="text" id="searchRegion" class="config-input" placeholder="例如 cn, us"></div>
            <div class="flex items-center justify-between"><label class="text-xs">搜索类型</label><select id="searchType" class="config-input w-24"><option value="auto">自动</option><option value="web">网页</option><option value="news">新闻</option><option value="images">图片</option></select></div>
            <div class="flex items-center justify-between"><label class="text-xs">AI智能判断类型</label><label class="switch small"><input type="checkbox" id="aiSearchTypeToggle"><span class="slider"></span></label></div>
            <div class="flex items-center justify-between"><label class="text-xs">显示搜索提示（右上角）</label><label class="switch small"><input type="checkbox" id="searchShowPromptToggle" checked><span class="slider"></span></label></div>
            <div class="flex items-center justify-between"><label class="text-xs">启用搜索结果优化</label><label class="switch small"><input type="checkbox" id="searchOptimizeToggle" checked><span class="slider"></span></label></div>
            <div class="flex items-center justify-between"><label class="text-xs">永久保存搜索结果到系统消息</label><label class="switch small"><input type="checkbox" id="searchAppendToSystem"><span class="slider"></span></label></div>
            <!-- 新增：隐藏模型思考过程开关 -->
            <div class="flex items-center justify-between"><label class="text-xs">隐藏模型思考过程</label><label class="switch small"><input type="checkbox" id="hideReasoningToggle"><span class="slider"></span></label></div>
            <div><label class="block text-xs text-gray-500 mb-1">搜索超时(秒) <span id="searchTimeoutValue">30</span></label><input type="range" id="searchTimeout" min="5" max="120" step="5" class="w-full" oninput="updateSearchParam('timeout',this.value)"></div>
            <div><label class="block text-xs text-gray-500 mb-1">最大结果数 <span id="maxSearchResultsValue">3</span></label><input type="range" id="maxSearchResults" min="1" max="10" step="1" class="w-full" oninput="updateSearchParam('results',this.value)"></div>
        </div>
    `;
    target.parentNode.insertBefore(section, target.nextSibling);
    loadSearchConfig();
    bindSearchEvents();
}

function bindSearchEvents() {
    getEl('searchToggle')?.addEventListener('change', function (e) {
        getEl('searchConfigDetails').style.display = this.checked ? 'block' : 'none';
        saveConfig();
        updateSearchButtonState(this.checked);
    });
    getEl('aiSearchJudgeToggle')?.addEventListener('change', function () {
        getEl('aiSearchJudgeDetails').style.display = this.checked ? 'block' : 'none';
        saveConfig();
    });
    ['aiSearchJudgeModel', 'aiSearchJudgePrompt', 'searchModel', 'searchProvider', 'searchApiKey', 'searchRegion', 'searchOptimizeToggle', 'searchTimeout', 'maxSearchResults', 'searchType', 'aiSearchTypeToggle', 'searchShowPromptToggle', 'searchAppendToSystem', 'hideReasoningToggle'].forEach(id => {
        const el = getEl(id);
        if (el) {
            el.addEventListener('change', saveConfig);
            if (id === 'searchApiKey') el.addEventListener('input', saveConfig);
        }
    });
}

function loadSearchConfig() {
    setChecked('searchToggle', localStorage.getItem('enableSearch') === 'true');
    setChecked('aiSearchJudgeToggle', localStorage.getItem('aiSearchJudge') === 'true');
    setVal('aiSearchJudgeModel', localStorage.getItem('aiSearchJudgeModel') || '');
    setVal('aiSearchJudgePrompt', localStorage.getItem('aiSearchJudgePrompt') || DEFAULT_CONFIG.aiSearchJudgePrompt);
    setVal('searchModel', localStorage.getItem('searchModel') || '');
    setVal('searchProvider', localStorage.getItem('searchProvider') || 'duckduckgo');
    setVal('searchApiKey', decrypt(localStorage.getItem('searchApiKey') || ''));
    setVal('searchRegion', localStorage.getItem('searchRegion') || '');
    setChecked('searchOptimizeToggle', localStorage.getItem('enableSearchOptimize') !== 'false');
    setVal('searchTimeout', localStorage.getItem('searchTimeout') || '30');
    setVal('maxSearchResults', localStorage.getItem('maxSearchResults') || '3');
    setVal('searchType', localStorage.getItem('searchType') || DEFAULT_CONFIG.searchType);
    setChecked('aiSearchTypeToggle', localStorage.getItem('aiSearchTypeToggle') === 'true');
    setChecked('searchShowPromptToggle', localStorage.getItem('searchShowPrompt') !== 'false');
    setChecked('searchAppendToSystem', localStorage.getItem('searchAppendToSystem') === 'true');
    setChecked('hideReasoningToggle', localStorage.getItem('hideReasoning') === 'true');

    const timeoutSpan = getEl('searchTimeoutValue');
    if (timeoutSpan) timeoutSpan.textContent = getVal('searchTimeout');
    const resultsSpan = getEl('maxSearchResultsValue');
    if (resultsSpan) resultsSpan.textContent = getVal('maxSearchResults');

    getEl('searchConfigDetails').style.display = getChecked('searchToggle') ? 'block' : 'none';
    getEl('aiSearchJudgeDetails').style.display = getChecked('aiSearchJudgeToggle') ? 'block' : 'none';
    updateSearchButtonState(getChecked('searchToggle'));
}

window.updateSearchParam = (type, val) => {
    if (type === 'timeout') {
        const span = getEl('searchTimeoutValue');
        if (span) span.innerText = val;
    } else if (type === 'results') {
        const span = getEl('maxSearchResultsValue');
        if (span) span.innerText = val;
    }
    saveConfig();
};

function createFontSizeSetting() {
    if (getEl('fontSizeSetting')) return;
    const target = getEl('paragraphPrefix')?.closest('.config-item');
    if (!target) return;
    const div = document.createElement('div');
    div.id = 'fontSizeSetting';
    div.className = 'config-item';
    div.innerHTML = `
        <div class="flex items-center justify-between">
            <label>字体大小 (px) <span id="fontSizeValue">16</span></label>
            <input type="range" id="fontSize" min="12" max="24" step="1" value="16" class="w-32" oninput="updateFontSize(this.value)">
        </div>
    `;
    target.parentNode.insertBefore(div, target.nextSibling);
    const sz = localStorage.getItem('fontSize') || DEFAULT_CONFIG.fontSize;
    setVal('fontSize', sz);
    const fontSizeSpan = getEl('fontSizeValue');
    if (fontSizeSpan) fontSizeSpan.innerText = sz;
    document.documentElement.style.setProperty('--chat-font-size', sz + 'px');
}

window.updateFontSize = val => {
    const span = getEl('fontSizeValue');
    if (span) span.innerText = val;
    document.documentElement.style.setProperty('--chat-font-size', val + 'px');
    localStorage.setItem('fontSize', val);
    saveConfig();
};

function createSearchToggleButton() {
    if (getEl('searchQuickToggle')) return;
    const wrapper = document.querySelector('.input-wrapper .flex');
    if (!wrapper) return;
    const btn = document.createElement('button');
    btn.id = 'searchQuickToggle';
    btn.type = 'button';
    btn.className = 'p-2 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition';
    btn.innerHTML = getSearchButtonIcon(false);
    btn.onclick = e => {
        e.preventDefault();
        const toggle = getEl('searchToggle');
        if (toggle) {
            toggle.checked = !toggle.checked;
            toggle.dispatchEvent(new Event('change'));
        }
    };
    const fileLabel = wrapper.querySelector('label[for="fileInput"]');
    if (fileLabel) {
        fileLabel.insertAdjacentElement('afterend', btn);
    } else {
        wrapper.prepend(btn);
    }
    updateSearchButtonState(getChecked('searchToggle'));
}

function updateSearchButtonState(checked) {
    const btn = getEl('searchQuickToggle');
    if (!btn) return;
    btn.innerHTML = getSearchButtonIcon(checked);
    btn.classList.toggle('text-blue-600', checked);
    btn.classList.toggle('dark:text-blue-400', checked);
}

function getSearchButtonIcon(checked) {
    return checked
        ? '<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 10l-4 4m0-4l4 4"/></svg>'
        : '<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>';
}

window.syncTokenFromRange = function () {
    setVal('maxTokensInput', getVal('maxTokens'));
    saveConfig();
};

window.syncTokenFromInput = function () {
    let v = parseInt(getVal('maxTokensInput')) || 4096;
    v = Math.min(65536, Math.max(256, v));
    setVal('maxTokensInput', v);
    setVal('maxTokens', v);
    saveConfig();
};

window.updateParam = (type, val) => {
    if (type === 'temp') {
        const span = getEl('tempValue');
        if (span) span.innerText = val;
    }
    saveConfig();
};

function saveConfig() {
    if (!checkStorageSpace()) {
        showToast('存储空间不足', 'warning');
        return;
    }
    localStorage.setItem('apiKey', encrypt(getVal('apiKey') || ''));
    localStorage.setItem('baseUrl', getVal('baseUrl') || '');
    localStorage.setItem('systemPrompt', getVal('systemPrompt') || '');
    localStorage.setItem('model', getVal('modelSelect') || '');
    localStorage.setItem('temp', getVal('temperature') || '0.7');
    localStorage.setItem('tokens', getVal('maxTokens') || '4096');
    localStorage.setItem('stream', getChecked('streamToggle'));
    localStorage.setItem('reasoningDelay', getVal('reasoningDelay') || '25');
    localStorage.setItem('contentDelay', getVal('contentDelay') || '12');
    localStorage.setItem('requestTimeout', getVal('requestTimeout') || '60');
    localStorage.setItem('compress', getChecked('compressToggle'));
    localStorage.setItem('threshold', getVal('compressThreshold') || '10');
    localStorage.setItem('compressModel', getVal('compressModel') || '');
    localStorage.setItem('customParams', getVal('customParams') || '');
    localStorage.setItem('customEnabled', getChecked('customParamsToggle'));
    localStorage.setItem('lineHeight', getVal('lineHeight') || '1.1');
    localStorage.setItem('paragraphMargin', getVal('paragraphMargin') || '0.1');
    localStorage.setItem('paragraphPrefix', getVal('paragraphPrefix') || 'none');
    localStorage.setItem('markdownGFM', getChecked('markdownGFM'));
    localStorage.setItem('markdownBreaks', getChecked('markdownBreaks'));
    localStorage.setItem('titleModel', getVal('titleModel') || '');
    localStorage.setItem('enableSearch', getChecked('searchToggle'));
    localStorage.setItem('aiSearchJudge', getChecked('aiSearchJudgeToggle'));
    localStorage.setItem('aiSearchJudgeModel', getVal('aiSearchJudgeModel') || '');
    localStorage.setItem('aiSearchJudgePrompt', getVal('aiSearchJudgePrompt') || DEFAULT_CONFIG.aiSearchJudgePrompt);
    localStorage.setItem('searchModel', getVal('searchModel') || '');
    localStorage.setItem('searchProvider', getVal('searchProvider') || 'duckduckgo');
    localStorage.setItem('searchApiKey', encrypt(getVal('searchApiKey') || ''));
    localStorage.setItem('searchRegion', getVal('searchRegion') || '');
    localStorage.setItem('enableSearchOptimize', getChecked('searchOptimizeToggle'));
    localStorage.setItem('searchTimeout', getVal('searchTimeout') || '30');
    localStorage.setItem('maxSearchResults', getVal('maxSearchResults') || '3');
    localStorage.setItem('fontSize', getVal('fontSize') || DEFAULT_CONFIG.fontSize);
    localStorage.setItem('searchType', getVal('searchType') || DEFAULT_CONFIG.searchType);
    localStorage.setItem('aiSearchTypeToggle', getChecked('aiSearchTypeToggle'));
    localStorage.setItem('searchShowPrompt', getChecked('searchShowPromptToggle'));
    localStorage.setItem('searchAppendToSystem', getChecked('searchAppendToSystem'));
    localStorage.setItem('hideReasoning', getChecked('hideReasoningToggle'));
}

window.updateDisplayParam = (type, val) => {
    if (type === 'lineHeight') {
        const span = getEl('lineHeightValue');
        if (span) span.innerText = parseFloat(val).toFixed(2);
        document.documentElement.style.setProperty('--chat-line-height', val);
    } else if (type === 'paragraphMargin') {
        const span = getEl('paragraphMarginValue');
        if (span) span.innerText = parseFloat(val).toFixed(2);
        document.documentElement.style.setProperty('--chat-paragraph-margin', val + 'rem');
    }
    saveConfig();
};

function applyParagraphPrefix(prefix) {
    const container = $.chatMessagesContainer;
    if (!container) return;
    container.classList.remove('paragraph-prefix-dot', 'paragraph-prefix-dash');
    if (prefix === 'dot') container.classList.add('paragraph-prefix-dot');
    else if (prefix === 'dash') container.classList.add('paragraph-prefix-dash');
}

window.updateParagraphPrefix = () => {
    applyParagraphPrefix(getVal('paragraphPrefix'));
    saveConfig();
};

window.updateMarkdownConfig = () => {
    if (window.marked) {
        marked.setOptions({ gfm: getChecked('markdownGFM'), breaks: getChecked('markdownBreaks'), pedantic: false });
        marked.use({ renderer: { paragraph: text => `<p>${text}</p>` } });
    }
    saveConfig();
    if (currentChatId) loadChat(currentChatId);
};

// ==================== 模型管理 ====================
window.fetchModels = async function () {
    const key = getVal('apiKey');
    const url = getVal('baseUrl');
    const selects = ['modelSelect', 'compressModel', 'titleModel', 'searchModel', 'aiSearchJudgeModel'];

    selects.forEach(id => {
        const el = getEl(id);
        if (el) el.innerHTML = '<option>加载中...</option>';
    });

    if (!key) {
        selects.forEach(id => {
            const el = getEl(id);
            if (el) el.innerHTML = '<option>请输入API Key</option>';
        });
        return;
    }

    try {
        const res = await fetch(`${url}/models`, { headers: { Authorization: `Bearer ${key}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const models = data.data || [];
        const modelOptions = models.map(m => `<option value="${m.id}">${m.id}</option>`).join('');

        const mainSelect = getEl('modelSelect');
        if (mainSelect) {
            mainSelect.innerHTML = modelOptions;
            mainSelect.value = localStorage.getItem('model') || DEFAULT_CONFIG.model;
        }

        ['compressModel', 'titleModel', 'searchModel', 'aiSearchJudgeModel'].forEach(id => {
            const sel = getEl(id);
            if (!sel) return;
            const placeholder = id === 'compressModel' ? '<option value="">默认</option>' : '<option value="">同主模型</option>';
            sel.innerHTML = placeholder + modelOptions;
            const saved = localStorage.getItem(id);
            if (saved && models.some(m => m.id === saved)) sel.value = saved;
            else if (models.length) sel.value = id === 'compressModel' ? models[0].id : '';
        });

        models.forEach(m => {
            modelContextLength[m.id] = m.context_length || 131072;
        });
        localStorage.setItem('modelContextLength', JSON.stringify(modelContextLength));

        const curModel = getVal('modelSelect');
        if (curModel && modelContextLength[curModel]) {
            const max = modelContextLength[curModel] - MAX_TOKENS_SAFETY_MARGIN;
            const maxTokensInput = getEl('maxTokens');
            const maxTokensInput2 = getEl('maxTokensInput');
            if (maxTokensInput) maxTokensInput.max = max;
            if (maxTokensInput2) maxTokensInput2.max = max;
            let cur = parseInt(getVal('maxTokens'));
            if (cur > max) {
                setVal('maxTokens', max);
                setVal('maxTokensInput', max);
                saveConfig();
            }
        }
    } catch (e) {
        showToast('获取模型列表失败', 'error');
    }
};

window.refreshModels = async function (e) {
    const btn = e?.target.closest('button');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
    }
    try {
        await window.fetchModels();
        showToast('模型列表已刷新', 'success');
    } catch {
        showToast('刷新失败', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
        }
    }
};

// ==================== 消息渲染 ====================
function showWelcome() {
    const container = $.chatMessagesContainer;
    if (!container) return;
    container.innerHTML = '<div class="welcome-container"><div class="brand">Hi , Nice to meet you !</div><p class="text-sm">开始新的对话 · NAUJTRATS</p></div>';
}

function copyMessageContent(content) {
    navigator.clipboard.writeText(compressNewlines(content, 2));
}

function autoImageLinks(markdownText) {
    const imageExt = /\.(jpe?g|png|gif|bmp|webp|svg)(\?.*)?$/i;
    return markdownText.replace(/(^|\s)(https?:\/\/[^\s]+)($|\s)/g, (match, before, url, after) => {
        if (imageExt.test(url) && !/!\[.*?\]\(/.test(match) && !/\[.*?\]\(/.test(match)) {
            return before + `![图片](${url})` + after;
        }
        return match;
    });
}

function appendMessage(role, text, files = null, reasoning = null, usage = null, time = 0, isLast = false) {
    const container = $.chatMessagesContainer;
    if (!container) return null;

    // 移除欢迎页
    if (container.children.length === 1 && container.children[0].classList.contains('welcome-container')) {
        container.innerHTML = '';
    }

    const row = document.createElement('div');
    row.className = `message-row ${role}`;

    const avatar = document.createElement('div');
    avatar.className = `avatar ${role}`;
    avatar.textContent = role === 'user' ? '我' : 'N';

    const wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';

    const bubble = document.createElement('div');
    bubble.className = `bubble ${role}`;

    // 思考过程
    if (role === 'assistant' && reasoning) {
        const details = document.createElement('details');
        details.className = 'reasoning-details';
        details.open = true;
        details.innerHTML = `<summary>深度思考</summary><div class="reasoning-content">${compressNewlines(reasoning, 2)}</div>`;
        bubble.appendChild(details);
    }

    // 用户文件
    if (role === 'user' && files?.length) {
        const fileList = document.createElement('div');
        fileList.className = 'file-list';
        files.forEach(f => {
            const url = URL.createObjectURL(new Blob([f.content], { type: 'text/plain' }));
            fileList.innerHTML += `<span class="file-item"><svg class="file-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M2 1.5C2 0.67 2.67 0 3.5 0h5.88c.4 0 .78.16 1.06.44l3.12 3.12c.28.28.44.66.44 1.06V14.5c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5v-13zM3.5 1c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h9c.28 0 .5-.22.5-.5V4.62L10.38 1H3.5z"/><path d="M9 1v3.5c0 .28.22.5.5.5H13v1H9.5C8.67 6 8 5.33 8 4.5V1h1z"/></svg><a href="${url}" download="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a></span>`;
        });
        bubble.appendChild(fileList);
    }

    // 主要内容
    const contentDiv = document.createElement('div');
    contentDiv.className = 'markdown-body';

    if (role === 'user') {
        contentDiv.innerHTML = escapeHtml(text || '').replace(/\n/g, '<br>');
    } else {
        let display = compressNewlines(text, 2);
        if (window.marked) {
            display = autoImageLinks(display);
            contentDiv.innerHTML = marked.parse(display);
        } else {
            contentDiv.innerHTML = `<pre>${escapeHtml(display)}</pre>`;
        }
        setTimeout(() => {
            attachCodeCopyButtons(bubble);
            applySyntaxHighlighting(bubble);
        }, 0);
    }
    bubble.appendChild(contentDiv);

    wrapper.appendChild(bubble);

    // 操作按钮
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    // 复制按钮
    const copyBtn = document.createElement('div');
    copyBtn.className = 'msg-action-btn copy-msg-btn';
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.onclick = (e) => {
        e.stopPropagation();
        copyMessageContent(text);
        copyBtn.style.background = '#bbf7d0';
        setTimeout(() => copyBtn.style.background = '', 300);
    };
    actions.appendChild(copyBtn);

    if (isLast) {
        if (role === 'user') {
            // 编辑按钮
            const editBtn = document.createElement('div');
            editBtn.className = 'msg-action-btn edit-btn';
            editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3l4 4L7 21H3v-4L17 3z"/><path d="M15 5l4 4"/></svg>';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                const msgs = chats[currentChatId].messages;
                const idx = msgs.findIndex(m => m.role === 'user' && m.text === text && JSON.stringify(m.files) === JSON.stringify(files));
                if (idx === -1) return;
                const sys = msgs.filter(m => m.role === 'system' && !m.temporary && !m.timestamp);
                const timestamp = msgs.find(m => m.timestamp);
                const others = msgs.slice(0, idx).filter(m => m.role !== 'system' || m.temporary || m.timestamp);
                chats[currentChatId].messages = [...sys, ...others, ...(timestamp ? [timestamp] : [])];
                saveChats();
                loadChat(currentChatId);
                if ($.userInput) {
                    $.userInput.value = text || '';
                    window.autoResize($.userInput);
                }
                pendingFiles = files ? files.map(f => ({ ...f })) : [];
                updateFilePreviewUI();
            };
            actions.appendChild(editBtn);
        } else {
            // 重新生成按钮
            const regenBtn = document.createElement('div');
            regenBtn.className = 'msg-action-btn regenerate-btn';
            regenBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
            regenBtn.onclick = async (e) => {
                e.stopPropagation();
                const msgs = chats[currentChatId].messages;
                const idx = msgs.findIndex(m => m.role === 'assistant' && m.content === text);
                if (idx === -1) return;
                const sys = msgs.filter(m => m.role === 'system' && !m.temporary && !m.timestamp);
                const timestamp = msgs.find(m => m.timestamp);
                const others = msgs.slice(0, idx).filter(m => m.role !== 'system' || m.temporary || m.timestamp);
                chats[currentChatId].messages = [...sys, ...others, ...(timestamp ? [timestamp] : [])];
                saveChats();
                loadChat(currentChatId);
                const lastUser = msgs.slice(0, idx).filter(m => m.role === 'user').pop();
                if (lastUser) await sendMessage(true, lastUser.text, lastUser.files);
            };
            actions.appendChild(regenBtn);
        }
    }

    if (actions.children.length) wrapper.appendChild(actions);

    // 底部统计
    if (role === 'assistant' && (usage || time > 0)) {
        const footer = document.createElement('div');
        footer.className = 'message-footer';
        let foot = `⏱️ ${(time / 1000).toFixed(1)}s`;
        if (usage) {
            const tokens = usage.total_tokens || (usage.completion_tokens + usage.prompt_tokens) || 0;
            foot += ` · ⚡ ${tokens}`;
            if (usage.prompt_cache_hit_tokens !== undefined && usage.prompt_cache_miss_tokens !== undefined) {
                const hit = usage.prompt_cache_hit_tokens;
                const miss = usage.prompt_cache_miss_tokens;
                const total = hit + miss;
                foot += total ? ` · 💾 ${((hit / total) * 100).toFixed(1)}%缓存命中(${hit}/${total})` : ' · 💾 缓存未启用';
            }
        }
        footer.textContent = foot;
        bubble.appendChild(footer);
    }

    row.appendChild(avatar);
    row.appendChild(wrapper);
    container.appendChild(row);

    if (!userScrolled && $.chatBox) {
        $.chatBox.scrollTop = $.chatBox.scrollHeight;
    }

    return bubble;
}

function attachCodeCopyButtons(container) {
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-copy-btn')) return;
        const btn = document.createElement('div');
        btn.className = 'code-copy-btn';
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        btn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(pre.innerText);
            btn.style.background = '#bbf7d0';
            setTimeout(() => btn.style.background = '', 300);
        };
        pre.style.position = 'relative';
        pre.appendChild(btn);
    });
}

function applySyntaxHighlighting(container) {
    if (window.hljs) {
        container.querySelectorAll('pre code').forEach(hljs.highlightElement);
    }
}

// ==================== 联网搜索 ====================
async function aiChooseSearchType(text, historySummary, signal) {
    const truncated = historySummary.length > MAX_HISTORY_LENGTH ? historySummary.slice(0, MAX_HISTORY_LENGTH) + '...(截断)' : historySummary;
    const now = new Date();
    const timeInfo = `当前真实时间：${now.toLocaleDateString()} ${now.toLocaleTimeString()}（时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}）。`;
    const prompt = `${timeInfo}\n请根据用户问题，判断最适合的搜索类型。只返回以下单词之一：web, news, images。不要解释。\n\n对话历史：${truncated}\n\n用户问题：${text}\n\n搜索类型：`;
    const model = getVal('aiSearchJudgeModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;
    const url = getVal('baseUrl');
    const key = getVal('apiKey');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_JUDGE_TIMEOUT);
    const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    try {
        const res = await fetch(`${url}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 10,
                thinking: { type: "disabled" }
            }),
            signal: combinedSignal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error();
        const data = await res.json();
        let type = data.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
        if (['web', 'news', 'images'].includes(type)) return type;
        return 'web';
    } catch {
        clearTimeout(timeoutId);
        return 'web';
    }
}

async function performWebSearch(query, signal, type = 'web') {
    const provider = getVal('searchProvider') || 'duckduckgo';
    const apiKey = getVal('searchApiKey') || '';
    const timeout = parseInt(getVal('searchTimeout')) * 1000;
    const max = parseInt(getVal('maxSearchResults')) || 3;
    const region = getVal('searchRegion') || '';
    const t = Date.now();

    const country = region && region.length === 2 ? region : '';

    let url = '';
    const headers = { 'Accept': 'application/json' };

    if (provider === 'brave') {
        let params = `q=${encodeURIComponent(query)}&count=${max}&_t=${t}`;
        if (country) params += `&country=${country}`;
        params += '&safesearch=off';
        if (SEARCH_PROXY) {
            url = `${SEARCH_PROXY}/brave?${params}&type=${type}`;
        } else {
            let endpoint = '';
            switch (type) {
                case 'news': endpoint = '/news/search'; break;
                case 'images': endpoint = '/images/search'; break;
                default: endpoint = '/web/search';
            }
            url = `https://api.search.brave.com/res/v1${endpoint}?${params}`;
        }
        headers['X-Subscription-Token'] = apiKey;
    } else if (provider === 'google') {
        url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=017576662512468239146:omuauf_lfve&q=${encodeURIComponent(query)}&num=${max}&_t=${t}${country ? '&gl=' + country : ''}`;
    } else {
        url = SEARCH_PROXY
            ? `${SEARCH_PROXY}/duckduckgo?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&_t=${t}${country ? '&kl=' + country : ''}`
            : `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&_t=${t}${country ? '&kl=' + country : ''}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    try {
        const res = await fetch(url, { method: 'GET', headers, signal: combinedSignal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`搜索失败: ${res.status}`);
        const data = await res.json();
        return parseSearchResults(data, provider, type);
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

function parseSearchResults(data, provider, type = 'web') {
    const results = [];
    if (provider === 'brave') {
        if (type === 'news' && data.news?.results) {
            results.push(...data.news.results.slice(0, 5).map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.description || r.content
            })));
        } else if (type === 'images' && data.images?.results) {
            results.push(...data.images.results.slice(0, 5).map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.description || '',
                thumbnail: r.thumbnail?.src || ''
            })));
        } else if (data.web?.results) {
            results.push(...data.web.results.slice(0, 5).map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.description
            })));
        }
    } else if (provider === 'google' && data.items) {
        results.push(...data.items.slice(0, 5).map(r => ({ title: r.title, url: r.link, snippet: r.snippet })));
    } else if (provider === 'duckduckgo') {
        if (data.AbstractText) results.push({ title: data.Heading || '摘要', url: data.AbstractURL || '', snippet: data.AbstractText });
        if (data.RelatedTopics) data.RelatedTopics.slice(0, 4).forEach(t => {
            if (t.Text) results.push({ title: t.Text.split('.')[0] || '相关', url: '', snippet: t.Text });
        });
    }
    return results;
}

function formatRawResults(results) {
    if (!results.length) return '未找到相关搜索结果。';
    return '【原始联网搜索结果】\n\n' + results.map((r, i) => {
        let line = `${i + 1}. ${r.title}\n   链接: ${r.url}\n   摘要: ${r.snippet}`;
        if (r.thumbnail) {
            line += `\n   ![图片](${r.thumbnail})`;
        }
        return line;
    }).join('\n\n');
}

async function generateSearchQuery(text, history, signal) {
    const model = getVal('aiSearchJudgeModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;
    const url = getVal('baseUrl');
    const key = getVal('apiKey');
    const truncated = history.length > MAX_HISTORY_LENGTH ? history.slice(0, MAX_HISTORY_LENGTH) + '...(截断)' : history;
    const now = new Date();
    const timeInfo = `当前真实时间：${now.toLocaleDateString()} ${now.toLocaleTimeString()}（时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}）。`;
    const prompt = `${timeInfo}\n你是一个搜索词优化助手。请结合以下对话历史，理解用户问题中的代词具体指代什么，然后生成一个简短（10个词以内）、精准的搜索引擎查询词。只返回查询词本身，不要有任何解释、标点或额外内容。\n\n对话历史：\n${truncated}\n\n用户问题：${text}\n\n优化后的搜索查询词：`;

    try {
        const res = await fetch(`${url}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 30,
                thinking: { type: "disabled" }
            }),
            signal
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        let query = data.choices?.[0]?.message?.content?.trim() || '';
        if (!query && data.choices?.[0]?.message?.reasoning_content) {
            query = data.choices[0].message.reasoning_content.split(/[。\n]/)[0]?.trim() || '';
        }
        return query.replace(/^[.,/#!$%^&*;:{}=\-_`~()"'\s]+|[.,/#!$%^&*;:{}=\-_`~()"'\s]+$/g, '') || text;
    } catch {
        return text;
    }
}

async function optimizeSearchResults(raw, question, signal, type = 'web') {
    if (!raw.length) return { success: false, message: '未找到相关搜索结果。' };
    const model = getVal('aiSearchJudgeModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;
    const url = getVal('baseUrl');
    const key = getVal('apiKey');
    const now = new Date();
    const timeInfo = `当前真实时间：${now.toLocaleDateString()} ${now.toLocaleTimeString()}（时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}）。`;

    let prompt;
    if (type === 'images') {
        prompt = `${timeInfo}\n你是一个专业的信息整理助手。请根据用户问题，对以下图片搜索结果进行优化。请保留每张图片的标题、链接和缩略图链接，并以 Markdown 格式呈现（例如 ![标题](缩略图)）。请确保图片可点击。\n\n用户问题：${question}\n\n原始搜索结果：\n${formatRawResults(raw)}\n\n请输出优化后的信息摘要，包含图片。`;
    } else {
        prompt = `${timeInfo}\n你是一个专业的信息整理助手。请根据用户问题，对以下联网搜索结果进行优化：\n- 去除冗余、重复、不相关的内容。\n- 优先保留来自权威来源、时效性强的信息。\n- 对多条信息进行综合，形成简洁、准确、有条理的摘要。\n- 如果信息明显过时或不可信，请注明。\n\n用户问题：${question}\n\n原始搜索结果：\n${formatRawResults(raw)}\n\n请输出优化后的信息摘要（以"【联网搜索结果（已优化）】"开头），并附上简要说明。如果没有任何有效信息，请说明"未找到有效信息"。`;
    }

    try {
        const res = await fetch(`${url}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 500,
                thinking: { type: "disabled" }
            }),
            signal
        });
        const data = await res.json();
        const optimized = data.choices?.[0]?.message?.content?.trim();
        return optimized ? { success: true, message: optimized } : { success: false, message: '优化失败，返回原始结果。' };
    } catch {
        return { success: false, message: '优化过程出错，返回原始结果。' };
    }
}

// 改进后的 AI 搜索判断函数（增强正则 + 关键词 fallback）
async function aiShouldSearch(text, history, signal) {
    if (!getChecked('aiSearchJudgeToggle')) return null;
    const truncated = history.length > MAX_HISTORY_LENGTH ? history.slice(0, MAX_HISTORY_LENGTH) + '...(截断)' : history;
    const now = new Date();
    const timeInfo = `当前真实时间：${now.toLocaleDateString()} ${now.toLocaleTimeString()}（时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}）。`;
    let prompt = (getVal('aiSearchJudgePrompt') || DEFAULT_CONFIG.aiSearchJudgePrompt).replace('{history}', truncated).replace('{text}', text);
    if (!prompt.includes('{history}')) prompt = `以下是对话历史：\n${truncated}\n\n用户问题：${text}\n\n请判断是否需要联网搜索。`;
    prompt = timeInfo + '\n' + prompt;

    const model = getVal('aiSearchJudgeModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;
    const url = getVal('baseUrl');
    const key = getVal('apiKey');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_JUDGE_TIMEOUT);
    const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    try {
        const res = await fetch(`${url}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: '你是一个判断是否需要联网搜索的助手。请严格根据用户问题判断，只返回一个单词 true 或 false，不要添加任何解释、标点或空格。' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 20,
                thinking: { type: "disabled" }
            }),
            signal: combinedSignal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error();
        const data = await res.json();
        let ans = data.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
        // 增强正则提取 true/false
        const match = ans.match(/\b(true|false)\b/);
        if (match) return match[0] === 'true';
        // 如果包含中文关键词也尝试理解
        if (ans.includes('需要') || ans.includes('应该') || ans.includes('true')) return true;
        if (ans.includes('不需要') || ans.includes('false')) return false;
        // fallback: 关键词匹配
        const smartKeywords = getSmartSearchKeywords();
        return smartKeywords.some(k => text.includes(k));
    } catch {
        clearTimeout(timeoutId);
        // 出错时也 fallback 到关键词匹配
        const smartKeywords = getSmartSearchKeywords();
        return smartKeywords.some(k => text.includes(k));
    }
}

function updateBubbleSearchStatus(bubble, status, isError = false) {
    if (!bubble || !bubble.querySelector || !currentChatId) return;
    if (!document.body.contains(bubble)) return;

    let statusDiv = bubble.querySelector('.search-status');
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.className = 'search-status';
        const markdownBody = bubble.querySelector('.markdown-body');
        if (markdownBody) {
            bubble.insertBefore(statusDiv, markdownBody);
        } else {
            bubble.appendChild(statusDiv);
        }
    } else {
        statusDiv.innerHTML = ''; // 清空旧内容
    }
    const line = document.createElement('div');
    line.textContent = status;
    if (isError) line.style.color = '#ef4444';
    statusDiv.appendChild(line);
}

// ==================== 消息发送核心 ====================
const rateLimit = {
    last: 0,
    min: 1000,
    allowed() {
        const now = Date.now();
        if (now - this.last < this.min) return false;
        this.last = now;
        return true;
    }
};

function stopGenerationForChat(chatId) {
    if (abortControllerMap[chatId]) {
        abortControllerMap[chatId].abort();
        delete abortControllerMap[chatId];
    }
    if (searchAbortControllerMap[chatId]) {
        searchAbortControllerMap[chatId].abort();
        delete searchAbortControllerMap[chatId];
    }
    delete isTypingMap[chatId];
    delete activeBubbleMap[chatId];
}

window.stopGeneration = function () {
    if (currentChatId) {
        stopGenerationForChat(currentChatId);
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
    }
};

function buildHistorySummary(chatId, maxLength = MAX_HISTORY_LENGTH) {
    const messages = chats[chatId]?.messages || [];
    const recent = messages.slice(-10);
    const summary = recent.map(m => {
        if (m.role === 'user') return `用户: ${(m.text || '').slice(0, 300)}`;
        if (m.role === 'assistant') return `助手: ${(m.content || '').slice(0, 300)}`;
        return '';
    }).filter(Boolean).join('\n');
    return summary.slice(0, maxLength) || '无历史记录';
}

// 改进：更全面的时间关键词检测，按需返回时间消息（不保存）
function createTemporaryTimestampIfNeeded(text) {
    // 扩展时间关键词列表，覆盖常见时间相关表达
    const timeKeywords = [
        '现在时间', '当前时间', '现在几点', '几点钟', '时间', 'date', 'time', 'now',
        '今天', '明天', '昨天', '星期', '周', '几号', '几月', '哪年', '今年', '去年', '明年',
        'weather', '天气', '新闻', 'news', '实时', '最新', '动态'
    ];
    const lowerText = text.toLowerCase();
    if (timeKeywords.some(kw => lowerText.includes(kw))) {
        const now = new Date();
        const timeContent = `当前时间戳：${now.toLocaleDateString()} ${now.toLocaleTimeString()} 时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
        return { role: 'system', content: timeContent, temporary: true };
    }
    return null;
}

function parseCommand(text) {
    const parts = text.split(' ');
    const cmd = parts[0].toLowerCase();
    if (cmd === '/search' || cmd === '/s') {
        return { force: true, type: 'web', query: parts.slice(1).join(' ').trim() };
    }
    if (cmd === '/news') {
        return { force: true, type: 'news', query: parts.slice(1).join(' ').trim() };
    }
    if (cmd === '/image') {
        return { force: true, type: 'images', query: parts.slice(1).join(' ').trim() };
    }
    return null;
}

function getSmartSearchKeywords() {
    return [
        '搜索', '最新', '新闻', '实时', '今天', '当前', '现在',
        '查找', '查询', '搜一下', '找找', '搜一搜',
        '什么是', '怎么样', '如何', '怎么', '为什么', '有没有', '哪里', '哪个', '多少',
        '几时', '何时', '何地', '哪些', '谁', '什么', '为何',
        '介绍一下', '解释', '定义', '意思', '用法', '教程', '指南', '方法', '步骤',
        '介绍', '说明', '详情', '资料', '信息', '数据', '报告', '动态', '情况',
        '对比', '区别', '不同', '差异', '优缺点', '哪个好',
        '下载', '安装', '使用', '设置', '配置',
        '是什么', '什么意思', '怎么办', '怎么做', '怎么用', '怎么弄',
        '关于', '有关', '对于',
        '搜', '查', '找', '问', '询', '探', '啥', '哪', '吗', '呢', '吧', '啊'
    ];
}

function getImageKeywords() {
    return ['图片', '照片', '截图', '图', '壁纸', 'gif', 'image', 'photo', 'picture', 'pic'];
}

async function determineSearchType(text, history, signal, forcedType) {
    if (forcedType) return forcedType;
    const hasImageIntent = getImageKeywords().some(kw => text.toLowerCase().includes(kw));
    const baseType = getVal('searchType') || 'web';
    if (baseType === 'auto') {
        if (hasImageIntent || getChecked('aiSearchTypeToggle')) {
            return hasImageIntent ? 'images' : await aiChooseSearchType(text, history, signal);
        }
        return 'web';
    }
    return baseType;
}

async function handleSearchFlow(chatId, text, forceSearch, queryText, history, signal, bubble, forcedType) {
    let shouldSearch = false;
    let aiDecision = null;
    let finalType = forcedType;
    let searchResults = null;
    let optimized = null;
    let searchError = null;

    const smartKeywords = getSmartSearchKeywords();

    if (forceSearch) {
        shouldSearch = true;
        if (!finalType) finalType = forcedType || 'web';
        updateBubbleSearchStatus(bubble, `🔍 强制搜索 (${finalType})`);
        if (getChecked('searchShowPromptToggle')) showToast(`🔍 强制搜索 (${finalType})`, 'info');
    } else if (getChecked('searchToggle')) {
        const aiJudge = getChecked('aiSearchJudgeToggle');
        if (aiJudge) {
            updateBubbleSearchStatus(bubble, '🤖 AI 判断是否需要搜索...');
            if (getChecked('searchShowPromptToggle')) showToast('🤖 AI智能判断是否需要搜索...', 'info', 2000);
            aiDecision = await aiShouldSearch(text, history, signal);
            if (aiDecision === true) {
                shouldSearch = true;
                updateBubbleSearchStatus(bubble, '🤖 AI 判断：需要联网搜索');
                if (getChecked('searchShowPromptToggle')) showToast('🤖 AI判断：需要联网搜索', 'info');
                if (getChecked('aiSearchTypeToggle')) {
                    updateBubbleSearchStatus(bubble, '🤖 AI 正在判断搜索类型...');
                    if (getChecked('searchShowPromptToggle')) showToast('🤖 AI正在判断搜索类型...', 'info', 2000);
                    finalType = await aiChooseSearchType(text, history, signal);
                    updateBubbleSearchStatus(bubble, `🤖 AI 选择：${finalType}搜索`);
                    if (getChecked('searchShowPromptToggle')) showToast(`🤖 AI选择：${finalType}搜索`, 'info');
                }
            } else if (aiDecision === false) {
                shouldSearch = false;
                updateBubbleSearchStatus(bubble, '🤖 AI 判断：无需联网搜索');
                if (getChecked('searchShowPromptToggle')) showToast('🤖 AI判断：无需联网搜索', 'info');
            } else {
                updateBubbleSearchStatus(bubble, '🤖 AI 判断：无法确定，使用关键词匹配');
                if (getChecked('searchShowPromptToggle')) showToast('🤖 AI判断：无法确定，使用关键词匹配', 'warning');
            }
        }
        if (!aiJudge || aiDecision === null) {
            shouldSearch = smartKeywords.some(k => text.includes(k));
        }
        if (shouldSearch && !finalType) {
            finalType = await determineSearchType(text, history, signal, null);
            const hasImageIntent = getImageKeywords().some(kw => text.toLowerCase().includes(kw));
            if (finalType === 'web' && hasImageIntent && getChecked('searchShowPromptToggle')) {
                showToast('💡 检测到您可能需要图片，可尝试使用 /image 命令', 'info', 5000);
            }
        }
    }

    if (shouldSearch && finalType) {
        const typeIcons = { web: '🔍', news: '📰', images: '🖼️' };
        const typeNames = { web: '网页', news: '新闻', images: '图片' };
        updateBubbleSearchStatus(bubble, `${typeIcons[finalType] || '🔍'} 正在搜索${typeNames[finalType] || ''}中...`);
        if (getChecked('searchShowPromptToggle')) showToast(`🔍 正在搜索${typeNames[finalType] || ''}中...`, 'info');

        const searchQuery = forceSearch ? queryText : (aiDecision === true ? await generateSearchQuery(text, history, signal) : text);
        try {
            searchResults = await performWebSearch(searchQuery, signal, finalType);
            const optimizeEnabled = getChecked('searchOptimizeToggle') !== false;
            if (optimizeEnabled) {
                const opt = await optimizeSearchResults(searchResults, text, signal, finalType);
                if (opt.success) optimized = opt.message;
                else optimized = formatRawResults(searchResults) + '\n\n（注：优化失败，此为原始结果）';
            } else {
                optimized = formatRawResults(searchResults);
            }
            updateBubbleSearchStatus(bubble, '📝 搜索完成，正在生成回答...');
            if (getChecked('searchShowPromptToggle')) showToast('📝 搜索完成，正在生成回答...', 'info');
        } catch (e) {
            searchError = e.message;
            updateBubbleSearchStatus(bubble, `❌ 搜索失败：${e.message}`, true);
            if (getChecked('searchShowPromptToggle')) showToast(`❌ 联网搜索失败: ${e.message}`, 'error', 5000);
        }
    }

    return { searchPerformed: shouldSearch, searchResults, optimized, searchError, searchType: finalType };
}

function buildApiMessages(chatId) {
    const apiMessages = [];

    for (const msg of chats[chatId].messages) {
        if (msg.role === 'system' && !msg.temporary) {
            apiMessages.push({ role: 'system', content: msg.content });
        }
    }

    if (apiMessages.length === 0) {
        const defaultSystemContent = getVal('systemPrompt') || DEFAULT_CONFIG.system;
        apiMessages.push({ role: 'system', content: defaultSystemContent });
        if (!chats[chatId].messages.some(m => m.role === 'system' && !m.temporary)) {
            chats[chatId].messages.unshift({ role: 'system', content: defaultSystemContent });
        }
    }

    for (const msg of chats[chatId].messages) {
        if (msg.role === 'system') continue;
        if (msg.role === 'user') {
            apiMessages.push({ role: 'user', content: buildUserContent(msg.text, msg.files) });
        } else if (msg.role === 'assistant' && !msg.partial) {
            apiMessages.push({ role: 'assistant', content: msg.content });
        } else if (msg.temporary) {
            apiMessages.push({ role: msg.role, content: msg.content });
        }
    }

    return apiMessages;
}

function adjustMaxTokens(model, requestedTokens, estimated) {
    const maxContext = modelContextLength[model] || 131072;
    let maxAllowed = maxContext - estimated - MAX_TOKENS_SAFETY_MARGIN;
    if (maxAllowed < 256) return null; // 溢出
    return Math.min(requestedTokens, maxAllowed);
}

async function streamResponse(res, chatId, pendingMsg, reasoningDelay, contentDelay) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let reasoningText = '';
    let hasContent = false;
    let usage = null;
    let placeholderCleared = false;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                    const data = JSON.parse(line.substring(6));
                    const delta = data.choices[0].delta;

                    if (!placeholderCleared && (delta.reasoning_content !== undefined || delta.content !== undefined)) {
                        const currentBubble = activeBubbleMap[chatId];
                        if (currentBubble && document.body.contains(currentBubble)) {
                            currentBubble.querySelector('.search-status')?.remove();
                        }
                        placeholderCleared = true;
                    }

                    if (delta.reasoning_content) {
                        reasoningText += delta.reasoning_content;
                        pendingMsg.reasoning = reasoningText;
                        if (currentChatId === chatId) {
                            const currentBubble = activeBubbleMap[chatId];
                            if (currentBubble) {
                                let details = currentBubble.querySelector('details.reasoning-details');
                                if (!details) {
                                    details = document.createElement('details');
                                    details.className = 'reasoning-details';
                                    details.open = true;
                                    details.innerHTML = `<summary>深度思考</summary><div class="reasoning-content"></div>`;
                                    const markdownBody = currentBubble.querySelector('.markdown-body');
                                    currentBubble.insertBefore(details, markdownBody);
                                }
                                details.querySelector('.reasoning-content').textContent = reasoningText;
                            }
                        }
                        const delay = document.hidden ? 0 : reasoningDelay;
                        await new Promise(r => setTimeout(r, delay));
                    }

                    if (delta.content !== undefined && delta.content !== null) {
                        fullText += delta.content;
                        pendingMsg.content = fullText;
                        if (currentChatId === chatId) {
                            const currentBubble = activeBubbleMap[chatId];
                            if (currentBubble) {
                                if (!hasContent) {
                                    currentBubble.classList.remove('typing');
                                    hasContent = true;
                                }
                                const display = compressNewlines(fullText, 2);
                                const processed = autoImageLinks(display);
                                currentBubble.querySelector('.markdown-body').innerHTML = window.marked ? marked.parse(processed) : `<pre>${escapeHtml(processed)}</pre>`;
                                attachCodeCopyButtons(currentBubble);
                                applySyntaxHighlighting(currentBubble);
                                if (!userScrolled && $.chatBox) {
                                    $.chatBox.scrollTop = $.chatBox.scrollHeight;
                                }
                            }
                        }
                        const delay = document.hidden ? 0 : contentDelay;
                        await new Promise(r => setTimeout(r, delay));
                    }

                    if (data.usage) usage = data.usage;
                } catch (e) { /* 忽略解析错误 */ }
            }
        }
    }
    return { fullText, reasoningText, usage };
}

async function handleNonStream(res, chatId, pendingMsg, currentBubble) {
    const data = await res.json();
    const msg = data.choices[0].message;
    const fullText = msg.content || '';
    const reasoningText = msg.reasoning_content || '';
    const usage = data.usage;

    pendingMsg.content = fullText;
    pendingMsg.reasoning = reasoningText;

    if (currentChatId === chatId && currentBubble) {
        currentBubble.querySelector('.search-status')?.remove();
        currentBubble.classList.remove('typing');
        let displayText = compressNewlines(fullText, 2);
        displayText = autoImageLinks(displayText);
        currentBubble.querySelector('.markdown-body').innerHTML = window.marked ? marked.parse(displayText) : `<pre>${escapeHtml(displayText)}</pre>`;
        attachCodeCopyButtons(currentBubble);
        applySyntaxHighlighting(currentBubble);
        if (reasoningText) {
            const details = document.createElement('details');
            details.className = 'reasoning-details';
            details.open = true;
            details.innerHTML = `<summary>深度思考</summary><div class="reasoning-content">${compressNewlines(reasoningText, 2)}</div>`;
            currentBubble.insertBefore(details, currentBubble.querySelector('.markdown-body'));
        }
        if (!userScrolled && $.chatBox) {
            $.chatBox.scrollTop = $.chatBox.scrollHeight;
        }
    }
    return { fullText, reasoningText, usage };
}

function handleError(e, chatId, pendingMsg, currentBubble) {
    if (pendingMsg.content.trim() === '' && pendingMsg.reasoning.trim() === '') {
        const idx = chats[chatId].messages.findIndex(m => m.partial);
        if (idx !== -1) chats[chatId].messages.splice(idx, 1);
    } else {
        delete pendingMsg.partial;
        pendingMsg.content = pendingMsg.content || '';
        pendingMsg.reasoning = pendingMsg.reasoning || '';
    }
    saveChats();
    if (currentChatId === chatId && currentBubble) {
        currentBubble.classList.remove('typing');
        const errorMsg = e.name === 'AbortError' ? '⚠️ 请求已停止或超时。' : `❌ 错误: ${e.message}`;
        currentBubble.querySelector('.markdown-body').innerHTML = errorMsg;
    } else if (currentChatId === chatId) {
        loadChat(chatId);
    }
    showToast(`请求失败: ${e.message}`, 'error');
}

window.sendMessage = async function (skipUserAdd = false, userTextForRegen = null, userFilesForRegen = null) {
    if (!rateLimit.allowed()) {
        showToast('请求过于频繁', 'warning');
        return;
    }

    const chatId = currentChatId;
    if (!chatId) return;
    if (isTypingMap[chatId]) {
        showToast('⏳ 正在生成中...', 'warning');
        return;
    }

    const input = $.userInput;
    let text = skipUserAdd ? userTextForRegen : input?.value.trim() || '';
    let files = skipUserAdd ? userFilesForRegen : pendingFiles;

    if (!skipUserAdd && !text && !files.length) {
        stopGenerationForChat(chatId);
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
        return;
    }

    // 重复消息检测
    const currentMsgKey = { text, files: files.map(f => f.name).join(',') };
    if (!skipUserAdd && lastSentMessage && lastSentMessage.text === currentMsgKey.text && lastSentMessage.files === currentMsgKey.files) {
        showToast('您刚刚发送过相同的消息', 'info');
        stopGenerationForChat(chatId);
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
        return;
    }
    lastSentMessage = currentMsgKey;

    // 按需生成临时时间戳消息（基于关键词）
    const temporaryTimestamp = createTemporaryTimestampIfNeeded(text);

    // 移除旧的临时消息
    chats[chatId].messages = chats[chatId].messages.filter(m => !m.temporary);
    const partialIdx = chats[chatId].messages.findIndex(m => m.partial);
    if (partialIdx !== -1) chats[chatId].messages.splice(partialIdx, 1);

    // 停止旧请求
    stopGenerationForChat(chatId);

    const abortMain = new AbortController();
    abortControllerMap[chatId] = abortMain;
    const abortSearch = new AbortController();
    searchAbortControllerMap[chatId] = abortSearch;

    isTypingMap[chatId] = true;
    if ($.sendBtn) $.sendBtn.classList.add('hidden');
    if ($.stopBtn) $.stopBtn.classList.add('visible');

    // 处理命令
    const command = parseCommand(text);
    const forceSearch = !!command;
    let queryText = command ? command.query : text;
    const forcedType = command ? command.type : null;

    // 构建历史摘要
    const historySummary = buildHistorySummary(chatId);

    // 添加用户消息
    if (!skipUserAdd) {
        chats[chatId].messages.push({ role: 'user', text, files: files.map(f => ({ name: f.name, content: f.content, size: f.size })) });
        if (chats[chatId].title === '新对话') {
            chats[chatId].title = text ? text.slice(0, 10) : (files.length ? '文件消息' : '新对话');
        }
        if (currentChatId === chatId) loadChat(chatId);
        if (input) {
            input.value = '';
            window.autoResize(input);
        }
        clearAllFiles();
        if (!userScrolled && $.chatBox) $.chatBox.scrollTop = $.chatBox.scrollHeight;
    }

    // 创建占位气泡
    const pendingMsg = { role: 'assistant', content: '', reasoning: '', partial: true };
    chats[chatId].messages.push(pendingMsg);
    let currentBubble = null;
    if (currentChatId === chatId) {
        currentBubble = appendMessage('assistant', '', null, null, null, 0, false);
        if (currentBubble) currentBubble.classList.add('typing');
        activeBubbleMap[chatId] = currentBubble;
    }

    // 执行搜索
    let searchResult = { searchPerformed: false, searchResults: null, optimized: null, searchError: null };
    if (getChecked('searchToggle') || forceSearch) {
        searchResult = await handleSearchFlow(chatId, text, forceSearch, queryText, historySummary, abortSearch.signal, currentBubble, forcedType);
    }

    // 保存搜索结果
    if (searchResult.searchPerformed && searchResult.optimized) {
        if (getChecked('searchAppendToSystem')) {
            chats[chatId].messages.push({ role: 'system', content: searchResult.optimized });
        } else {
            chats[chatId].messages.push({ role: 'system', content: searchResult.optimized, temporary: true });
        }
    }

    // 可选：上下文压缩
    if (!skipUserAdd && getChecked('compressToggle')) {
        const threshold = parseInt(getVal('compressThreshold')) || 10;
        const nonSys = chats[chatId].messages.filter(m => m.role !== 'system' && !m.partial && !m.temporary).length;
        if (nonSys > threshold) await compressContextIfNeeded(chatId);
    }

    // 构建API消息
    let apiMessages = buildApiMessages(chatId);

    // 如果有临时时间戳，插入到系统消息之后
    if (temporaryTimestamp) {
        const sysIndex = apiMessages.findIndex(m => m.role === 'system');
        if (sysIndex !== -1) {
            apiMessages.splice(sysIndex + 1, 0, temporaryTimestamp);
        } else {
            apiMessages.unshift(temporaryTimestamp);
        }
    }

    // 如果开启了“隐藏思考过程”，修改第一条系统消息，追加指令
    if (getChecked('hideReasoningToggle')) {
        const sysMsg = apiMessages.find(m => m.role === 'system');
        if (sysMsg) {
            sysMsg.content += ' 请直接给出最终答案，不要包含任何思考过程、分析步骤或解释。';
        }
    }

    // 选择模型
    let model = getVal('modelSelect') || DEFAULT_CONFIG.model;
    if (searchResult.searchPerformed && searchResult.searchResults?.length) {
        const searchModel = getVal('searchModel');
        if (searchModel && searchModel !== '加载中...') model = searchModel;
    }

    // 估算tokens
    const totalText = apiMessages.map(m => m.content).join(' ');
    const estimated = estimateTokens(totalText);
    const requestedTokens = parseInt(getVal('maxTokens')) || 4096;
    const adjustedTokens = adjustMaxTokens(model, requestedTokens, estimated);
    if (adjustedTokens === null) {
        handleError(new Error('消息过长，请压缩或减少历史'), chatId, pendingMsg, currentBubble);
        return;
    }
    if (adjustedTokens < requestedTokens) {
        console.warn(`max_tokens 从 ${requestedTokens} 调整为 ${adjustedTokens}`);
        setVal('maxTokens', adjustedTokens);
        setVal('maxTokensInput', adjustedTokens);
    }

    // 构建请求体
    const body = {
        model,
        messages: apiMessages,
        stream: getChecked('streamToggle'),
        temperature: parseFloat(getVal('temperature')) || 0.7,
        max_tokens: adjustedTokens
    };
    if (getChecked('customParamsToggle')) {
        try {
            Object.assign(body, JSON.parse(getVal('customParams') || '{}'));
        } catch { /* 忽略 */ }
    }

    const timeout = parseInt(getVal('requestTimeout')) * 1000;
    const timeoutId = setTimeout(() => abortMain.abort(), timeout);
    const startTime = Date.now();

    try {
        const res = await fetch(`${getVal('baseUrl')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getVal('apiKey')}` },
            body: JSON.stringify(body),
            signal: abortMain.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

        let usage = null;
        if (getChecked('streamToggle')) {
            const result = await streamResponse(res, chatId, pendingMsg, parseInt(getVal('reasoningDelay')), parseInt(getVal('contentDelay')));
            usage = result.usage;
        } else {
            const result = await handleNonStream(res, chatId, pendingMsg, currentBubble);
            usage = result.usage;
        }

        delete pendingMsg.partial;
        pendingMsg.time = Date.now() - startTime;
        pendingMsg.usage = usage;
        saveChats();
        if (currentChatId === chatId) loadChat(chatId);
        const defaultTitle = text ? text.slice(0, 10) : (files.length ? '文件消息' : '新对话');
        if (!skipUserAdd && chats[chatId].title === defaultTitle) {
            autoGenerateTitle(chatId);
        }
    } catch (e) {
        handleError(e, chatId, pendingMsg, currentBubble);
    } finally {
        // 清理临时消息
        chats[chatId].messages = chats[chatId].messages.filter(m => !m.temporary);
        delete isTypingMap[chatId];
        delete abortControllerMap[chatId];
        delete searchAbortControllerMap[chatId];
        delete activeBubbleMap[chatId];
        if (currentChatId === chatId) {
            if ($.sendBtn) $.sendBtn.classList.remove('hidden');
            if ($.stopBtn) $.stopBtn.classList.remove('visible');
        }
        if (Object.keys(isTypingMap).length === 0) localStorage.removeItem('ongoingChats');
        else saveOngoingChatsSnapshot();
    }
};

// ==================== 对话管理 ====================
function saveOngoingChatsSnapshot() {
    localStorage.setItem('ongoingChats', JSON.stringify(Object.keys(isTypingMap).filter(id => isTypingMap[id])));
}

async function restoreOngoingChats() {
    const ongoing = JSON.parse(localStorage.getItem('ongoingChats') || '[]');
    for (const id of ongoing) {
        if (chats[id]) {
            const lastUser = [...chats[id].messages].reverse().find(m => m.role === 'user');
            if (lastUser) await sendMessage(true, lastUser.text, lastUser.files);
        }
    }
    localStorage.removeItem('ongoingChats');
}

async function compressContextIfNeeded(chatId) {
    const msgs = chats[chatId].messages;
    const threshold = parseInt(getVal('compressThreshold')) || 10;

    const sysMessages = msgs.filter(m => m.role === 'system' && !m.temporary);
    const partial = msgs.filter(m => m.partial);
    const nonPartial = msgs.filter(m => m.role !== 'system' && !m.partial && !m.temporary);

    if (nonPartial.length <= threshold) return;

    const keep = Math.max(2, Math.floor(threshold / 2));
    const toSummarize = nonPartial.slice(0, nonPartial.length - keep);
    const toKeepNonPartial = nonPartial.slice(-keep);

    let conv = '';
    for (const m of toSummarize) {
        if (m.role === 'user') {
            conv += `用户: ${buildUserContent(m.text, m.files)}\n`;
        } else {
            conv += `助手: ${m.content}\n`;
        }
    }
    const prompt = `总结以下对话的核心内容：\n${conv}`;
    const model = getVal('compressModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;

    try {
        const res = await fetch(`${getVal('baseUrl')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getVal('apiKey')}` },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.5, max_tokens: 300, thinking: { type: "enabled" } })
        });
        const data = await res.json();
        const summary = data.choices?.[0]?.message?.content || '';

        const summaryMsg = { role: 'system', content: '[历史摘要] ' + summary };
        const newMessages = [...sysMessages, summaryMsg, ...toKeepNonPartial, ...partial];
        chats[chatId].messages = newMessages;
        saveChats();
        if (currentChatId === chatId) loadChat(chatId);
    } catch {
        showToast('上下文压缩失败', 'error');
    }
}

async function autoGenerateTitle(chatId) {
    const msgs = chats[chatId].messages.filter(m => m.role !== 'system' && !m.partial);
    if (msgs.length < 2) return;
    let recent = '';
    for (const m of msgs.slice(0, 4)) {
        if (m.role === 'user') recent += `用户: ${buildUserContent(m.text, m.files)}\n`;
        else recent += `助手: ${m.content}\n`;
    }
    const prompt = `根据对话生成一个简短的标题（${TITLE_MAX_LENGTH}字以内）：\n${recent}`;
    const model = getVal('titleModel') || getVal('modelSelect') || DEFAULT_CONFIG.model;
    if (!model) return;
    try {
        const body = {
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5,
            max_tokens: 20
        };
        if (!model.toLowerCase().includes('deepseek')) {
            body.thinking = { type: "enabled" };
        }
        const res = await fetch(`${getVal('baseUrl')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getVal('apiKey')}` },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        let finalTitle = data.choices[0].message.content.replace(/[""']/g, '').trim() || '新对话';
        if (finalTitle.length > TITLE_MAX_LENGTH) finalTitle = finalTitle.slice(0, TITLE_MAX_LENGTH);
        typeTitle(chatId, finalTitle);
    } catch (e) { /* 静默失败 */ }
}

async function typeTitle(chatId, finalTitle, index = 0) {
    if (currentChatId !== chatId) {
        chats[chatId].title = finalTitle;
        saveChats();
        renderChatHistory();
        updateHeaderTitle();
        return;
    }
    if (index === 0) {
        chats[chatId].title = '';
        saveChats();
        renderChatHistory();
        updateHeaderTitle();
    }
    if (index < finalTitle.length) {
        chats[chatId].title = finalTitle.substring(0, index + 1);
        saveChats();
        renderChatHistory();
        updateHeaderTitle();
        await new Promise(r => setTimeout(r, 10));
        typeTitle(chatId, finalTitle, index + 1);
    } else {
        chats[chatId].title = finalTitle;
        saveChats();
        renderChatHistory();
        updateHeaderTitle();
    }
}

function saveChats() {
    if (!checkStorageSpace()) cleanupOldChats(5);
    localStorage.setItem('chats', JSON.stringify(chats));
}

function renderChatHistory() {
    const list = getEl('chatHistoryList');
    if (!list) return;
    list.innerHTML = Object.keys(chats).reverse().map(id => `
        <div onclick="window.loadChat('${id}')" class="group flex items-center justify-between p-2 rounded-xl cursor-pointer transition ${id === currentChatId ? 'bg-white dark:bg-gray-800 shadow-sm text-blue-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'}">
            <span class="truncate text-sm">${escapeHtml(chats[id].title)}</span>
            <button onclick="window.deleteChat(event, '${id}')" class="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500"><svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
        </div>
    `).join('');
}

window.deleteChat = function (e, id) {
    e.stopPropagation();
    if (!confirm('删除对话？')) return;
    if (abortControllerMap[id]) abortControllerMap[id].abort();
    if (searchAbortControllerMap[id]) searchAbortControllerMap[id].abort();
    delete abortControllerMap[id];
    delete searchAbortControllerMap[id];
    delete isTypingMap[id];
    delete activeBubbleMap[id];
    delete chats[id];
    saveChats();
    const keys = Object.keys(chats);
    if (keys.length) loadChat(keys[keys.length - 1]);
    else createNewChat();
    renderChatHistory();
};

window.createNewChat = function () {
    const id = 'chat_' + Date.now();
    chats[id] = {
        title: '新对话',
        messages: [
            { role: 'system', content: getVal('systemPrompt') || DEFAULT_CONFIG.system }
        ]
    };
    saveChats();
    loadChat(id);
    renderChatHistory();
    updateHeaderTitle();
};

window.loadChat = function (id) {
    currentChatId = id;
    localStorage.setItem('lastChatId', id);
    const container = $.chatMessagesContainer;
    if (!container) return;

    const prefix = container.classList.contains('paragraph-prefix-dot') ? 'dot' : (container.classList.contains('paragraph-prefix-dash') ? 'dash' : 'none');
    container.innerHTML = '';
    applyParagraphPrefix(prefix);

    const displayMsgs = chats[id].messages.filter(m => m.role !== 'system');
    if (!displayMsgs.length) {
        showWelcome();
    } else {
        displayMsgs.forEach((m, i) => {
            if (m.role === 'user') {
                appendMessage('user', m.text || '', m.files || null, null, null, null, i === displayMsgs.length - 1);
            } else {
                appendMessage('assistant', compressNewlines(m.content, 2), null, m.reasoning, m.usage, m.time, i === displayMsgs.length - 1);
            }
        });
    }

    if (isTypingMap[id] && displayMsgs.length) {
        activeBubbleMap[id] = container.lastElementChild?.querySelector('.bubble.assistant');
    } else {
        delete activeBubbleMap[id];
    }

    renderChatHistory();
    updateHeaderTitle();

    if (isTypingMap[id]) {
        if ($.sendBtn) $.sendBtn.classList.add('hidden');
        if ($.stopBtn) {
            $.stopBtn.classList.remove('hidden');
            $.stopBtn.classList.add('visible');
        }
    } else {
        if ($.sendBtn) $.sendBtn.classList.remove('hidden');
        if ($.stopBtn) $.stopBtn.classList.remove('visible');
    }

    if (isMobile()) {
        $.sidebar?.classList.remove('mobile-open');
        $.configPanel?.classList.remove('mobile-open');
        $.sidebarMask?.classList.remove('active');
    }
};

function updateHeaderTitle() {
    if ($.chatTitle && currentChatId && chats[currentChatId]) {
        $.chatTitle.textContent = chats[currentChatId].title || '新对话';
    }
}

// ==================== 初始化 ====================
function cacheDOMElements() {
    $.chatBox = getEl('chatBox');
    $.chatMessagesContainer = getEl('chatMessagesContainer');
    $.userInput = getEl('userInput');
    $.sendBtn = getEl('sendBtn');
    $.stopBtn = getEl('stopBtn');
    $.filePreviewContainer = getEl('filePreviewContainer');
    $.fileInput = getEl('fileInput');
    $.scrollToBottomBtn = getEl('scrollToBottomBtn');
    $.chatTitle = getEl('chatTitle');
    $.sidebar = getEl('sidebar');
    $.configPanel = getEl('configPanel');
    $.sidebarMask = getEl('sidebarMask');
    $.sidebarToggle = getEl('sidebarToggle');
    $.searchQuickToggle = getEl('searchQuickToggle');
}

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .bubble.assistant.typing .markdown-body { min-height:1.5em; position:relative; }
        .bubble.assistant.typing .markdown-body::after { content:'...'; display:inline-block; animation:typing-dots 1.2s steps(4,end) infinite; width:1.5em; text-align:left; font-size:1.2em; line-height:1; opacity:0.7; }
        @keyframes typing-dots { 0%,20% { content:''; } 40% { content:'.'; } 60% { content:'..'; } 80%,100% { content:'...'; } }
        .bubble.assistant { padding:12px 16px; }
        .toast-container { position:fixed; top:20px; right:20px; z-index:9999; }
        .toast { display:flex; align-items:center; padding:12px 16px; margin-bottom:10px; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15); animation:slideIn 0.3s ease-out; max-width:350px; min-width:200px; }
        .toast-success { background:#d1fae5; color:#065f46; border-left:4px solid #10b981; }
        .toast-error { background:#fee2e2; color:#991b1b; border-left:4px solid #ef4444; }
        .toast-warning { background:#fef3c7; color:#92400e; border-left:4px solid #f59e0b; }
        .toast-info { background:#dbeafe; color:#1e40af; border-left:4px solid #3b82f6; }
        .toast-icon { margin-right:10px; font-weight:bold; }
        .toast-message { flex:1; font-size:14px; }
        .toast-close { background:none; border:none; font-size:18px; cursor:pointer; color:inherit; opacity:0.7; margin-left:10px; }
        .toast-close:hover { opacity:1; }
        @keyframes slideIn { from { transform:translateX(100%); opacity:0; } to { transform:translateX(0); opacity:1; } }
        
        .markdown-body img { max-width: 100%; max-height: 300px; object-fit: contain; border-radius: 8px; margin: 8px 0; }
        .markdown-body a { color: #0366d6; text-decoration: underline; text-underline-offset: 2px; }
        .markdown-body a:hover { color: #0056b3; text-decoration: none; background-color: #f0f6ff; }
        .search-placeholder { color: #666; font-style: italic; }
        .search-status { background: rgba(0,0,0,0.03); border-radius: 4px; padding: 4px 8px; margin-bottom: 8px; font-size: 0.9em; color: #666; max-height: 100px; overflow-y: auto; }
        .dark .search-status { background: rgba(255,255,255,0.1); color: #aaa; }
    `;
    document.head.appendChild(style);
}

function initializeConfig() {
    setVal('apiKey', decrypt(localStorage.getItem('apiKey') || '') || DEFAULT_CONFIG.key);
    setVal('baseUrl', localStorage.getItem('baseUrl') || DEFAULT_CONFIG.url);
    setVal('systemPrompt', localStorage.getItem('systemPrompt') || DEFAULT_CONFIG.system);
    setVal('customParams', localStorage.getItem('customParams') || DEFAULT_CONFIG.customParams);
    setChecked('customParamsToggle', localStorage.getItem('customEnabled') === 'true');

    const temp = localStorage.getItem('temp') || '0.7';
    setVal('temperature', temp);
    const tempSpan = getEl('tempValue');
    if (tempSpan) tempSpan.innerText = temp;

    const tokens = localStorage.getItem('tokens') || '4096';
    setVal('maxTokens', tokens);
    setVal('maxTokensInput', tokens);

    setChecked('streamToggle', localStorage.getItem('stream') !== 'false');
    setVal('reasoningDelay', localStorage.getItem('reasoningDelay') || DEFAULT_CONFIG.reasoningDelay);
    setVal('contentDelay', localStorage.getItem('contentDelay') || DEFAULT_CONFIG.contentDelay);
    setVal('requestTimeout', localStorage.getItem('requestTimeout') || DEFAULT_CONFIG.requestTimeout);
    setChecked('compressToggle', localStorage.getItem('compress') === 'true');
    setVal('compressThreshold', localStorage.getItem('threshold') || '10');
    setVal('compressModel', localStorage.getItem('compressModel') || '');

    const lh = parseFloat(localStorage.getItem('lineHeight') || DEFAULT_CONFIG.lineHeight);
    setVal('lineHeight', lh);
    const lhSpan = getEl('lineHeightValue');
    if (lhSpan) lhSpan.innerText = lh.toFixed(2);
    document.documentElement.style.setProperty('--chat-line-height', lh);

    const pm = parseFloat(localStorage.getItem('paragraphMargin') || DEFAULT_CONFIG.paragraphMargin);
    setVal('paragraphMargin', pm);
    const pmSpan = getEl('paragraphMarginValue');
    if (pmSpan) pmSpan.innerText = pm.toFixed(2);
    document.documentElement.style.setProperty('--chat-paragraph-margin', pm + 'rem');

    setVal('paragraphPrefix', localStorage.getItem('paragraphPrefix') || DEFAULT_CONFIG.paragraphPrefix);
    applyParagraphPrefix(getVal('paragraphPrefix'));

    setChecked('markdownGFM', localStorage.getItem('markdownGFM') !== 'false');
    setChecked('markdownBreaks', localStorage.getItem('markdownBreaks') !== 'false');
    if (window.marked) {
        marked.setOptions({ gfm: getChecked('markdownGFM'), breaks: getChecked('markdownBreaks'), pedantic: false });
    }

    if (localStorage.getItem('dark') === 'true') toggleDarkMode(true);
    else {
        const theme = getEl('hljsTheme');
        if (theme) theme.href = 'lib/atom-one-light.min.css';
    }

    createTitleModelSelector();
    createSearchConfigSection();
    createFontSizeSetting();
    createSearchToggleButton();

    if (!$.chatTitle) {
        const header = document.querySelector('header');
        const left = header?.querySelector('.flex.items-center.gap-4');
        const right = header?.querySelector('.flex.items-center.gap-3');
        if (left && right) {
            const title = document.createElement('div');
            title.id = 'chatTitle';
            title.className = 'chat-title';
            title.textContent = '新对话';
            header.insertBefore(title, right);
            $.chatTitle = title;
        }
    }

    // 移动端配置输入框聚焦时自动展开面板
    if (isMobile()) {
        const configInputs = $.configPanel?.querySelectorAll('input, textarea, select');
        configInputs?.forEach(el => {
            el.addEventListener('focus', () => {
                keyboardActive = true;
                if ($.configPanel && !$.configPanel.classList.contains('mobile-open')) {
                    $.configPanel.classList.add('mobile-open');
                    $.sidebarMask?.classList.add('active');
                }
                setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
            });
            el.addEventListener('blur', () => {
                keyboardActive = false;
            });
        });
    }
}

function setupEventListeners() {
    window.addEventListener('resize', handleResize);

    if ($.chatBox) {
        $.chatBox.addEventListener('scroll', throttle(() => {
            const { scrollTop, scrollHeight, clientHeight } = $.chatBox;
            const atBottom = scrollHeight - scrollTop - clientHeight < 50;
            if ($.scrollToBottomBtn) {
                if (!atBottom) {
                    $.scrollToBottomBtn.classList.add('visible');
                    userScrolled = true;
                } else {
                    $.scrollToBottomBtn.classList.remove('visible');
                    userScrolled = false;
                }
            }
        }, 100));
    }

    const wrapper = document.querySelector('.input-wrapper');
    const drop = getEl('dropOverlayInput');
    if (wrapper && drop) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
            document.body.addEventListener(ev, e => e.preventDefault());
        });
        wrapper.addEventListener('dragenter', e => { e.preventDefault(); drop.classList.add('show'); });
        wrapper.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('show'); });
        wrapper.addEventListener('dragleave', e => {
            e.preventDefault();
            if (!wrapper.contains(e.relatedTarget)) drop.classList.remove('show');
        });
        wrapper.addEventListener('drop', async e => {
            e.preventDefault();
            drop.classList.remove('show');
            if (e.dataTransfer.files.length) await processSelectedFiles(e.dataTransfer.files);
        });
    }

    if ($.fileInput) {
        $.fileInput.addEventListener('change', async e => {
            if (e.target.files.length) await processSelectedFiles(e.target.files);
            e.target.value = '';
        });
    }

    if ($.userInput) {
        $.userInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        window.autoResize($.userInput);
        $.userInput.addEventListener('input', function () { window.autoResize(this); });
        window.addEventListener('resize', debounce(() => window.autoResize($.userInput), 100));
    }
}

function loadInitialData() {
    fetchModels();
    const last = localStorage.getItem('lastChatId');
    if (last && chats[last]) loadChat(last);
    else createNewChat();
    renderChatHistory();
    prevWidth = window.innerWidth;
    if (isMobile()) {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        $.configPanel?.classList.remove('mobile-open', 'hidden-panel');
        $.sidebarMask?.classList.remove('active');
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'block';
    } else {
        $.sidebar?.classList.remove('mobile-open', 'collapsed');
        $.configPanel?.classList.add('hidden-panel');
        $.sidebarMask?.classList.remove('active');
        if ($.sidebarToggle) $.sidebarToggle.style.display = 'none';
    }
}

async function loadAllResources() {
    const resources = [
        { type: 'script', src: 'lib/marked.min.js' },
        { type: 'script', src: 'lib/highlight.min.js' },
        { type: 'script', src: 'lib/mammoth.browser.min.js' },
        { type: 'script', src: 'lib/xlsx.full.min.js' },
        { type: 'style', href: 'lib/atom-one-light.min.css', id: 'hljsTheme' }
    ];
    try {
        await Promise.all(resources.map(r => r.type === 'script' ? loadScript(r.src) : loadStyle(r.href, r.id)));
    } catch (err) {
        console.warn('部分资源加载失败', err);
        showToast('部分资源加载失败', 'error');
    }
    initializeApp();
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

function loadStyle(href, id) {
    return new Promise((resolve, reject) => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        if (id) l.id = id;
        l.onload = resolve;
        l.onerror = reject;
        document.head.appendChild(l);
    });
}

function initializeApp() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    async function init() {
        cacheDOMElements();
        injectStyles();
        initializeConfig();
        setupEventListeners();
        loadInitialData();
        restoreOngoingChats();
        window.addEventListener('beforeunload', saveOngoingChatsSnapshot);
    }
}

// 启动
loadAllResources();