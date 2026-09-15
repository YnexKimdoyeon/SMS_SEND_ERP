#!/bin/bash
# ============================================
# 백엔드 서버 중지 스크립트
# 사용법: bash stop.sh
# ============================================

cd "$(dirname "$0")"

if [ -f uvicorn.pid ]; then
    PID=$(cat uvicorn.pid)
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        rm -f uvicorn.pid
        echo "[OK] 서버 중지됨 (PID: $PID)"
    else
        rm -f uvicorn.pid
        echo "[!] 프로세스가 이미 종료되었습니다"
    fi
else
    echo "[!] uvicorn.pid 파일이 없습니다"
    echo "    수동 확인: ps aux | grep uvicorn"
fi
