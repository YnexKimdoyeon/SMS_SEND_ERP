#!/bin/bash
# ============================================
# 백엔드 서버 시작 스크립트
# 사용법: bash start.sh
# ============================================

cd "$(dirname "$0")"

# 가상환경 활성화
source venv/bin/activate

# 이미 실행 중인지 확인
if [ -f uvicorn.pid ]; then
    OLD_PID=$(cat uvicorn.pid)
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "[!] 서버가 이미 실행 중입니다 (PID: $OLD_PID)"
        echo "    중지하려면: bash stop.sh"
        exit 1
    else
        rm -f uvicorn.pid
    fi
fi

# 백그라운드로 uvicorn 실행
nohup uvicorn main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --workers 1 \
    > ~/logs/backend.log 2>&1 &

echo $! > uvicorn.pid
echo "[OK] 서버 시작됨 (PID: $!)"
echo "     로그: tail -f ~/logs/backend.log"
