#!/bin/bash
# 启动RAG知识库服务器
cd "$(dirname "$0")"
source ~/.local/bin/activate 2>/dev/null || true
export RAG_LLM_KEY=""   # 留空则从oneapichat的配置读取
export RAG_LLM_URL="https://api.deepseek.com"
export RAG_LLM_MODEL="deepseek-chat"
export RAG_PORT=8765

# 检查chroma是否可用
python3 -c "import chromadb" 2>/dev/null || {
    echo "正在安装依赖..."
    pip3 install --user --break-system-packages chromadb fastapi uvicorn 2>&1 | tail -3
}

python3 rag_server.py
