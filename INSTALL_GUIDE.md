# PayFlow 카페24 리눅스 서버 설치 가이드

## 1. 서버 접속

```bash
ssh 계정명@서버주소
```

---

## 2. 필수 프로그램 설치

### Python 3.11+ 확인
```bash
python3 --version
# 3.11 이상이어야 합니다

# 없으면 설치
sudo yum install python3 python3-pip   # CentOS
# 또는
sudo apt install python3 python3-pip   # Ubuntu
```

### Node.js 18+ 설치
```bash
# nvm으로 설치 (권장)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
node -v   # v18.x.x 확인
```

### Git 설치
```bash
sudo yum install git   # CentOS
# 또는
sudo apt install git   # Ubuntu
```

---

## 3. 소스 코드 다운로드

```bash
cd ~
git clone https://github.com/YnexKimdoyeon/SMS_SEND_ERP.git
cd SMS_SEND_ERP
```

> 현재 GitHub에는 frontend만 올라가 있습니다.
> backend 폴더도 함께 업로드하거나, 아래 4번에서 직접 파일을 올려주세요.

---

## 4. 백엔드 설정 (FastAPI)

### 파일 업로드 (GitHub에 backend가 없는 경우)
로컬 PC에서 backend 폴더를 서버로 전송:
```bash
# 로컬 PC에서 실행
scp -r backend/ 계정명@서버주소:~/SMS_SEND_ERP/backend/
```

### 패키지 설치
```bash
cd ~/SMS_SEND_ERP/backend
pip3 install -r requirements.txt
```

### 알리고 API 설정
```bash
cp .env.example .env
vi .env
```

아래 값을 실제 값으로 수정:
```
ALIGO_API_KEY=실제_API_키
ALIGO_USER_ID=실제_유저_ID
ALIGO_SENDER=발신번호(01012345678)
```

### 백엔드 테스트 실행
```bash
python3 main.py
# "Uvicorn running on http://0.0.0.0:8000" 확인 후 Ctrl+C
```

---

## 5. 프론트엔드 설정 (Next.js)

### API 주소 변경

프론트엔드가 서버의 백엔드를 가리키도록 수정해야 합니다.

```bash
cd ~/SMS_SEND_ERP/frontend
vi app/api.ts
```

첫 줄을 서버 도메인에 맞게 수정:
```typescript
// 방법 1: 같은 서버에서 돌릴 경우
const API_BASE = "http://서버IP:8000/api";

// 방법 2: 도메인이 있는 경우
const API_BASE = "https://내도메인.com/api";
```

### 패키지 설치 및 빌드
```bash
npm install
npm run build
```

### 프론트엔드 테스트 실행
```bash
npm run start -- -p 3000
# 브라우저에서 http://서버IP:3000 접속 확인 후 Ctrl+C
```

---

## 6. 백그라운드 실행 (pm2)

서버를 껐다 켜도 자동으로 실행되게 pm2를 사용합니다.

### pm2 설치
```bash
npm install -g pm2
```

### 백엔드 등록
```bash
cd ~/SMS_SEND_ERP/backend
pm2 start "python3 main.py" --name payflow-backend
```

### 프론트엔드 등록
```bash
cd ~/SMS_SEND_ERP/frontend
pm2 start "npm run start -- -p 3000" --name payflow-frontend
```

### 상태 확인
```bash
pm2 status
```

출력 예시:
```
┌──────────────────┬────┬──────┬───────┐
│ name             │ id │ mode │ status│
├──────────────────┼────┼──────┼───────┤
│ payflow-backend  │ 0  │ fork │ online│
│ payflow-frontend │ 1  │ fork │ online│
└──────────────────┴────┴──────┴───────┘
```

### 서버 재시작 시 자동 실행
```bash
pm2 startup
pm2 save
```

---

## 7. 포트 방화벽 열기

카페24 관리 콘솔 또는 서버에서 포트를 열어줍니다.

```bash
# CentOS (firewalld)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=8000/tcp
sudo firewall-cmd --reload

# Ubuntu (ufw)
sudo ufw allow 3000
sudo ufw allow 8000
```

---

## 8. (선택) Nginx 리버스 프록시

도메인으로 접속하고 싶으면 Nginx를 설정합니다.

### Nginx 설치
```bash
sudo yum install nginx    # CentOS
# 또는
sudo apt install nginx    # Ubuntu
```

### 설정 파일 작성
```bash
sudo vi /etc/nginx/conf.d/payflow.conf
```

```nginx
server {
    listen 80;
    server_name 내도메인.com;

    # 프론트엔드
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 백엔드 API
    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> Nginx를 사용하면 프론트엔드의 API_BASE를 다음과 같이 변경:
> ```typescript
> const API_BASE = "/api";
> ```
> 같은 도메인에서 API를 호출하므로 CORS 문제도 없어집니다.

### Nginx 시작
```bash
sudo nginx -t          # 설정 검증
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## 9. (선택) HTTPS 적용

Let's Encrypt로 무료 SSL 인증서 적용:
```bash
sudo yum install certbot python3-certbot-nginx   # CentOS
# 또는
sudo apt install certbot python3-certbot-nginx    # Ubuntu

sudo certbot --nginx -d 내도메인.com
```

자동 갱신 확인:
```bash
sudo certbot renew --dry-run
```

---

## 10. 접속 확인

| 항목 | URL |
|------|-----|
| 직접 접속 (Nginx 없이) | http://서버IP:3000 |
| 도메인 접속 (Nginx 사용) | http://내도메인.com |
| HTTPS 적용 후 | https://내도메인.com |
| 백엔드 API 문서 | http://서버IP:8000/docs |

---

## 자주 쓰는 명령어

```bash
# 서비스 상태 확인
pm2 status

# 로그 보기
pm2 logs payflow-backend
pm2 logs payflow-frontend

# 재시작
pm2 restart payflow-backend
pm2 restart payflow-frontend

# 전체 재시작
pm2 restart all

# 중지
pm2 stop all

# 코드 업데이트 후 재배포
cd ~/SMS_SEND_ERP
git pull
cd backend && pip3 install -r requirements.txt
cd ../frontend && npm install && npm run build
pm2 restart all
```

---

## 문제 해결

### 포트 충돌
```bash
# 포트 사용 중인 프로세스 확인
lsof -i :3000
lsof -i :8000
# kill -9 PID 로 종료
```

### DB 초기화 (데이터 전부 삭제)
```bash
cd ~/SMS_SEND_ERP/backend
rm payment.db
pm2 restart payflow-backend
```

### 백엔드 CORS 에러
backend/main.py에서 allow_origins에 실제 도메인 추가:
```python
allow_origins=["http://서버IP:3000", "https://내도메인.com"]
```
