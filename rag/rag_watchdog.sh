#!/bin/bash
# RAG 服务看门狗 - 自动检测并重启
PORT=8765
LOG=/tmp/rag_watchdog.log
RAG_DIR=/var/www/html/oneapichat/rag

check_and_restart() {
    if ! curl -sf --max-time 3 http://127.0.0.1:$PORT/health > /dev/null 2>&1; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') RAG 无响应，尝试重启..." >> $LOG
        # 杀掉旧进程
        ps aux | grep 'python3.*rag_server' | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null
        sleep 2
        # 启动新进程
        cd $RAG_DIR && nohup python3 rag_server.py > /tmp/rag_server.log 2>&1 &
        sleep 3
        if curl -sf --max-time 3 http://127.0.0.1:$PORT/health > /dev/null 2>&1; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') RAG 已重启成功" >> $LOG
        else
            echo "$(date '+%Y-%m-%d %H:%M:%S') RAG 重启失败" >> $LOG
        fi
    fi
}

# 如果带 loop 参数则持续运行
if [ "$1" = "loop" ]; then
    while true; do
        check_and_restart
        sleep 30
    done
else
    check_and_restart
fi
