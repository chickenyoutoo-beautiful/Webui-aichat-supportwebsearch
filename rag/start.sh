#!/bin/bash
# RAG知识库服务器启动脚本
cd "$(dirname "$0")"
export HF_ENDPOINT=https://hf-mirror.com
pkill -f rag_server.py 2>/dev/null
sleep 1
nohup python3 rag_server.py > /tmp/rag_server.log 2>&1 &
echo "RAG server started, PID: $!"
