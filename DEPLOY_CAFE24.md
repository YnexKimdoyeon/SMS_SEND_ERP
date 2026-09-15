# 카페24 우분투 서버 배포 가이드

> 도메인: `https://ynex3.mycafe24.com`

## 목차
1. [서버 접속](#1-서버-접속)
2. [기본 환경 설정](#2-기본-환경-설정)
3. [프로젝트 업로드](#3-프로젝트-업로드)
4. [백엔드 설치 및 실행](#4-백엔드-설치-및-실행)
5. [프론트엔드 빌드 및 배포](#5-프론트엔드-빌드-및-배포)
6. [Nginx 설치 및 설정](#6-nginx-설치-및-설정)
7. [SSL 인증서 설정](#7-ssl-인증서-설정)
8. [서버 자동 시작 설정](#8-서버-자동-시작-설정)
9. [서버 관리 명령어](#9-서버-관리-명령어)
10. [문제 해결](#10-문제-해결)

---

## 1. 서버 접속

```bash
# SSH로 카페24 서버 접속
ssh root@ynex3.mycafe24.com

# 포트가 다른 경우
ssh -p 2222 root@ynex3.mycafe24.com
```

> 카페24 호스팅 관리 페이지 → SSH 설정에서 접속 정보를 확인하세요.

---

## 2. 기본 환경 설정

### 2-1. 시스템 패키지 업데이트

```bash
sudo apt update && sudo apt upgrade -y
```

### 2-2. Python 설치

```bash
# 버전 확인
python3 --version

# 3.8 미만이거나 없으면 설치
sudo apt install -y python3 python3-pip python3-venv
```

### 2-3. Node.js 설치 (서버에서 프론트엔드 빌드하는 경우)

> 로컬 PC에서 빌드 후 업로드하는 경우 이 단계는 건너뛰세요.

```bash
# nvm 설치
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

# Node.js 20 LTS 설치
nvm install 20
nvm use 20
node --version   # v20.x.x 확인
```

### 2-4. Nginx 설치

```bash
sudo apt install -y nginx

# 설치 확인
nginx -v

# 부팅 시 자동 시작 등록
sudo systemctl enable nginx
```

### 2-5. 디렉토리 구조 생성

```bash
mkdir -p ~/apps/payflow        # 프로젝트 루트
mkdir -p ~/apps/data           # DB 저장 (웹 접근 불가 경로)
mkdir -p ~/apps/data/backup    # DB 백업
mkdir -p ~/logs                # 로그
```

최종 디렉토리 구조:
```
~/                          ← /root
├── apps/
│   ├── payflow/
│   │   ├── backend/       ← FastAPI 백엔드
│   │   └── frontend/      ← Next.js 소스 (빌드용)
│   └── data/
│       ├── payment.db     ← SQLite DB
│       └── backup/        ← DB 백업
├── logs/
│   └── backend.log        ← 백엔드 로그

/var/www/payflow/           ← 프론트엔드 빌드 결과물 (웹 루트)
```

---

## 3. 프로젝트 업로드



### 4-1. 가상환경 생성 및 패키지 설치

```bash
cd ~/apps/payflow/backend

# 가상환경 생성
python3 -m venv venv

# 활성화
source venv/bin/activate

# 패키지 설치
pip install --upgrade pip
pip install -r requirements.txt
```

### 4-2. 환경 변수 설정

```bash
cp .env.example .env
nano .env
```

아래 값들을 **반드시** 수정하세요:

```env
# === 필수 설정 (반드시 변경!) ===
ADMIN_PASSWORD=여기에10자이상비밀번호입력
JWT_SECRET_KEY=여기에32자이상랜덤문자열

# === 알리고 SMS API ===
ALIGO_API_KEY=실제_API_키
ALIGO_USER_ID=실제_유저_ID
ALIGO_SENDER=실제_발신번호

# === 보안 설정 ===
ALLOWED_ORIGINS=https://ynex3.mycafe24.com
ALLOWED_HOSTS=ynex3.mycafe24.com

# === DB 경로 (웹에서 접근 불가능한 경로) ===
DATABASE_URL=sqlite:////root/apps/data/payment.db
```

JWT_SECRET_KEY 생성:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
# 출력된 값을 .env의 JWT_SECRET_KEY에 붙여넣기
```

### 4-3. 실행 스크립트 권한 부여

```bash
chmod +x start.sh stop.sh
```

### 4-4. 서버 시작 및 확인

```bash
bash start.sh

# 정상 동작 확인
curl http://127.0.0.1:8000/api/health
# {"status":"ok"} 이면 성공!
```

---

## 5. 프론트엔드 빌드 및 배포

### 방법 A: 로컬 PC에서 빌드 후 업로드 (권장)

```bash
cd frontend

npm install
npm run build

# out/ 폴더 생성됨 → 서버에 업로드
scp -r out/* root@ynex3.mycafe24.com:/var/www/payflow/
```

### 방법 B: 서버에서 직접 빌드

```bash
cd ~/apps/payflow/frontend

npm install
npm run build

# 빌드 결과물을 웹 루트로 복사
cp -r out/* /var/www/payflow/
```

### 배포 확인

```bash
# index.html이 있는지 확인
ls /var/www/payflow/index.html
```

---

## 6. Nginx 설치 및 설정

Nginx가 하는 역할:
- `https://ynex3.mycafe24.com/` → 프론트엔드 정적 파일 제공
- `https://ynex3.mycafe24.com/api/*` → 백엔드(uvicorn 포트 8000)로 프록시

### 6-1. 기존 기본 설정 비활성화

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

### 6-2. 사이트 설정 파일 생성

```bash
sudo nano /etc/nginx/sites-available/payflow
```

아래 내용을 **통째로 복사해서 붙여넣기**:

```nginx
server {
    listen 80;
    server_name ynex3.mycafe24.com;

    # === 프론트엔드 정적 파일 ===
    root /var/www/payflow;
    index index.html;

    # === API 요청 → 백엔드로 프록시 ===
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        # 타임아웃 설정 (엑셀 다운로드 등 오래 걸리는 요청 대비)
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # === 프론트엔드 라우팅 ===
    location / {
        try_files $uri $uri/ /index.html;
    }

    # === 보안 헤더 ===
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # === 정적 파일 캐싱 ===
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # === DB 파일 접근 차단 ===
    location ~* \.(db|sqlite|sqlite3)$ {
        deny all;
    }

    # === 숨김 파일 접근 차단 ===
    location ~ /\. {
        deny all;
    }
}
```

### 6-3. 설정 활성화

```bash
# 심볼릭 링크 생성 (sites-available → sites-enabled)
sudo ln -s /etc/nginx/sites-available/payflow /etc/nginx/sites-enabled/payflow

# 설정 문법 검사
sudo nginx -t
# "syntax is ok" / "test is successful" 이 나와야 함

# Nginx 재시작
sudo systemctl restart nginx
```

### 6-4. 동작 확인

```bash
# Nginx 상태 확인
sudo systemctl status nginx

# 프론트엔드 확인
curl -I http://ynex3.mycafe24.com
# HTTP/1.1 200 OK 이면 성공

# API 프록시 확인
curl http://ynex3.mycafe24.com/api/health
# {"status":"ok"} 이면 성공
```

### 6-5. 방화벽 설정 (필요한 경우)

```bash
# HTTP(80), HTTPS(443) 포트 열기
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## 7. SSL 인증서 설정 (HTTPS)

카페24에서 SSL이 자동 제공되지 않는 경우, Let's Encrypt로 무료 인증서를 설치합니다.

### 7-1. Certbot 설치

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 7-2. 인증서 발급 및 Nginx 자동 설정

```bash
sudo certbot --nginx -d ynex3.mycafe24.com
```

이메일 입력 → 약관 동의(Y) → 완료되면 자동으로 Nginx에 HTTPS 설정이 추가됩니다.

### 7-3. 자동 갱신 확인

```bash
# 갱신 테스트
sudo certbot renew --dry-run

# 자동 갱신은 certbot이 자동으로 cron/systemd timer에 등록합니다
```

### 7-4. HTTPS 동작 확인

```bash
curl -I https://ynex3.mycafe24.com
# HTTP/2 200 이면 성공

curl https://ynex3.mycafe24.com/api/health
# {"status":"ok"} 이면 성공
```

---

## 8. 서버 자동 시작 설정

서버가 재부팅되어도 백엔드가 자동으로 실행되도록 설정합니다.

### 방법 A: crontab (간단)

```bash
crontab -e
```

맨 아래에 추가:

```
@reboot cd /root/apps/payflow/backend && bash start.sh
```

### 방법 B: systemd 서비스 (안정적, 권장)

```bash
sudo nano /etc/systemd/system/payflow.service
```

아래 내용 붙여넣기:

```ini
[Unit]
Description=PayFlow Backend API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/apps/payflow/backend
ExecStart=/root/apps/payflow/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=5
StandardOutput=append:/root/logs/backend.log
StandardError=append:/root/logs/backend.log

[Install]
WantedBy=multi-user.target
```

```bash
# 서비스 등록 및 시작
sudo systemctl daemon-reload
sudo systemctl enable payflow
sudo systemctl start payflow

# 상태 확인
sudo systemctl status payflow
```

> systemd를 사용하면 프로세스가 죽어도 자동 재시작됩니다. 이 방법을 쓰면 start.sh/stop.sh 대신 `sudo systemctl start/stop/restart payflow`로 관리합니다.

---

## 9. 서버 관리 명령어

### 백엔드 서버

```bash
# --- start.sh/stop.sh 사용 시 ---
cd ~/apps/payflow/backend
bash start.sh              # 시작
bash stop.sh               # 중지
bash stop.sh && bash start.sh  # 재시작

# --- systemd 사용 시 ---
sudo systemctl start payflow     # 시작
sudo systemctl stop payflow      # 중지
sudo systemctl restart payflow   # 재시작
sudo systemctl status payflow    # 상태 확인
```

### Nginx

```bash
sudo systemctl restart nginx     # 재시작
sudo systemctl reload nginx      # 설정만 리로드 (무중단)
sudo nginx -t                    # 설정 문법 검사
```

### 로그 확인

```bash
# 백엔드 로그
tail -f ~/logs/backend.log

# Nginx 접근 로그
sudo tail -f /var/log/nginx/access.log

# Nginx 에러 로그
sudo tail -f /var/log/nginx/error.log
```

### DB 백업

```bash
# 수동 백업
cp ~/apps/data/payment.db ~/apps/data/backup/payment_$(date +%Y%m%d).db

# 자동 백업 설정 (매일 새벽 3시)
crontab -e
# 아래 줄 추가:
0 3 * * * cp /root/apps/data/payment.db /root/apps/data/backup/payment_$(date +\%Y\%m\%d).db
```

### 프론트엔드 업데이트

로컬 PC에서 빌드 후:

```bash
scp -r out/* root@ynex3.mycafe24.com:/var/www/payflow/
```

---

## 10. 문제 해결

### 백엔드가 안 켜질 때

```bash
# 로그 확인
cat ~/logs/backend.log

# Python 환경 확인
cd ~/apps/payflow/backend
source venv/bin/activate
python3 -c "import fastapi; print('OK')"

# 포트 충돌 확인
lsof -i :8000

# .env 파일 확인
cat .env
```

### 사이트에 접속이 안 될 때

```bash
# Nginx 상태
sudo systemctl status nginx

# Nginx 설정 오류 확인
sudo nginx -t

# Nginx 에러 로그
sudo tail -20 /var/log/nginx/error.log

# 방화벽 확인
sudo ufw status
```

### API 요청이 안 될 때

```bash
# 1. 백엔드 자체가 살아있는지 확인
curl http://127.0.0.1:8000/api/health

# 2. Nginx를 통해 확인
curl http://ynex3.mycafe24.com/api/health

# 3. CORS 문제면 .env 확인
grep ALLOWED ~/apps/payflow/backend/.env
```

### SMS 발송 실패

```bash
grep -i "sms\|aligo\|error" ~/logs/backend.log | tail -20
grep ALIGO ~/apps/payflow/backend/.env
```

### DB 관련 문제

```bash
# DB 파일 확인
ls -la ~/apps/data/payment.db

# 권한 문제면
chmod 755 ~/apps/data/
chmod 644 ~/apps/data/payment.db
```

### Nginx 502 Bad Gateway

백엔드가 꺼져있으면 502 에러가 납니다.

```bash
# 백엔드 실행 상태 확인
curl http://127.0.0.1:8000/api/health

# 꺼져있으면 재시작
cd ~/apps/payflow/backend && bash start.sh
# 또는
sudo systemctl restart payflow
```

---

## 전체 설치 한눈에 보기

```bash
# 1. 시스템 패키지
sudo apt update && sudo apt install -y python3 python3-pip python3-venv nginx

# 2. 디렉토리 생성
mkdir -p ~/apps/payflow ~/apps/data ~/apps/data/backup ~/logs ~/www

# 3. 프로젝트 업로드
cd ~/apps/payflow
git clone <repo-url> .

# 4. 백엔드 설치
cd backend
python3 -m venv venv && source venv/bin/activate
pip install --upgrade pip && pip install -r requirements.txt
cp .env.example .env && nano .env          # ← 환경변수 수정!
chmod +x start.sh stop.sh
bash start.sh
curl http://127.0.0.1:8000/api/health      # ← 확인

# 5. 프론트엔드 배포
cp -r ../frontend/out/* /var/www/payflow/

# 6. Nginx 설정
sudo rm -f /etc/nginx/sites-enabled/default
sudo nano /etc/nginx/sites-available/payflow   # ← 위 6-2 내용 붙여넣기
sudo ln -s /etc/nginx/sites-available/payflow /etc/nginx/sites-enabled/payflow
sudo nginx -t && sudo systemctl restart nginx

# 7. SSL 인증서 (HTTPS)
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ynex3.mycafe24.com

# 8. 자동 시작 등록
(crontab -l 2>/dev/null; echo "@reboot cd /root/apps/payflow/backend && bash start.sh") | crontab -

# 9. 최종 확인
curl https://ynex3.mycafe24.com/api/health
```
