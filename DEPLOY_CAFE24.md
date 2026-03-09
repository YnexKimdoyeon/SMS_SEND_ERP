================================================================================
        원설 문자 발송 시스템 - Ubuntu 서버 배포 가이드 (HTTPS)
================================================================================

도메인: https://ynex3.mycafe24.com
서버: Cafe24 Ubuntu (EASY B: 2CPU, 4GB RAM)

================================================================================
[1] 서버 초기 설정
================================================================================

# 1-1. SSH 접속
ssh root@서버IP주소

# 1-2. 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# 1-3. 필수 패키지 설치
sudo apt install -y curl wget git build-essential software-properties-common

# 1-4. 방화벽 설정
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
sudo ufw status

# 1-5. 타임존 설정 (한국)
sudo timedatectl set-timezone Asia/Seoul


================================================================================
[2] Node.js 설치 (프론트엔드용)
================================================================================

# Node.js 20 LTS 설치
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 버전 확인
node -v
npm -v

# PM2 설치 (프로세스 매니저)
sudo npm install -g pm2


================================================================================
[3] Python 설치 (백엔드용)
================================================================================

# Python 3.11 설치
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3.11-dev python3-pip

# 기본 Python 설정
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# pip 업그레이드
python3 -m pip install --upgrade pip


================================================================================
[4] Nginx 설치 (웹서버 & 리버스 프록시)
================================================================================

sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx


================================================================================
[5] 프로젝트 폴더 생성 및 코드 업로드
================================================================================

# 프로젝트 폴더 생성
sudo mkdir -p /var/www/payment-sms
sudo chown -R $USER:$USER /var/www/payment-sms

# 로컬에서 파일 업로드 (로컬 PC에서 실행)
# scp -r /path/to/원설문자프로젝트/* root@서버IP:/var/www/payment-sms/

# 또는 Git 사용
cd /var/www/payment-sms
git clone [your-repo-url] .


================================================================================
[6] 백엔드 설정 (FastAPI)
================================================================================

# 백엔드 폴더로 이동
cd /var/www/payment-sms/backend

# 가상환경 생성 및 활성화
python3 -m venv venv
source venv/bin/activate

# 의존성 설치
pip install -r requirements.txt
pip install openpyxl

# .env 파일 생성
cat > .env << 'EOF'
ALIGO_API_KEY=여기에_알리고_API_키
ALIGO_USER_ID=여기에_알리고_유저ID
ALIGO_SENDER=여기에_발신번호
EOF

# 테스트 실행
python -m uvicorn main:app --host 0.0.0.0 --port 8000

# 정상 작동하면 Ctrl+C로 종료


================================================================================
[7] 프론트엔드 설정 (Next.js)
================================================================================

# 프론트엔드 폴더로 이동
cd /var/www/payment-sms/frontend

# .env.local 생성 (HTTPS)
cat > .env.local << 'EOF'
NEXT_PUBLIC_API_URL=https://ynex3.mycafe24.com/api
EOF

# 의존성 설치
npm install

# 프로덕션 빌드
npm run build


================================================================================
[8] SSL 인증서 설치 (Let's Encrypt)
================================================================================

# Certbot 설치
sudo apt install -y certbot python3-certbot-nginx

# SSL 인증서 발급 (도메인이 서버 IP를 가리키고 있어야 함)
sudo certbot --nginx -d ynex3.mycafe24.com

# 이메일 입력, 약관 동의(Y), 뉴스레터(N)

# 자동 갱신 테스트
sudo certbot renew --dry-run


================================================================================
[9] Nginx 설정
================================================================================

# Nginx 설정 파일 생성
sudo nano /etc/nginx/sites-available/payment-sms

# 아래 내용 붙여넣기:
--------------------------------------------------------------------------------
server {
    listen 80;
    server_name ynex3.mycafe24.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ynex3.mycafe24.com;

    # SSL 인증서 (certbot이 자동으로 설정함)
    ssl_certificate /etc/letsencrypt/live/ynex3.mycafe24.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ynex3.mycafe24.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # 보안 헤더
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # 프론트엔드 (Next.js)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # 백엔드 API
    location /api {
        proxy_pass http://127.0.0.1:8000/api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
--------------------------------------------------------------------------------

# 설정 파일 활성화
sudo ln -s /etc/nginx/sites-available/payment-sms /etc/nginx/sites-enabled/

# 기본 설정 제거
sudo rm /etc/nginx/sites-enabled/default

# 설정 테스트
sudo nginx -t

# Nginx 재시작
sudo systemctl restart nginx


================================================================================
[10] PM2로 앱 실행 (자동 재시작)
================================================================================

# 백엔드 실행 스크립트 생성
cat > /var/www/payment-sms/backend/start.sh << 'EOF'
#!/bin/bash
cd /var/www/payment-sms/backend
source venv/bin/activate
exec uvicorn main:app --host 127.0.0.1 --port 8000
EOF

chmod +x /var/www/payment-sms/backend/start.sh

# PM2 ecosystem 설정 파일 생성
cat > /var/www/payment-sms/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'payment-frontend',
      cwd: '/var/www/payment-sms/frontend',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'payment-backend',
      cwd: '/var/www/payment-sms/backend',
      script: '/var/www/payment-sms/backend/start.sh',
      interpreter: '/bin/bash'
    }
  ]
}
EOF

# PM2로 앱 시작
cd /var/www/payment-sms
pm2 start ecosystem.config.js

# PM2 상태 확인
pm2 status

# 로그 확인
pm2 logs

# 서버 재부팅 시 자동 시작 설정
pm2 save
pm2 startup
# 출력되는 명령어를 복사해서 실행


================================================================================
[11] CORS 설정 변경 (중요!)
================================================================================

# 백엔드 main.py에서 CORS 허용 도메인을 수정해야 합니다.
# main.py의 allow_origins 부분을 아래와 같이 변경:

nano /var/www/payment-sms/backend/main.py

# 변경 전:
#   allow_origins=["http://localhost:3000"],
# 변경 후:
#   allow_origins=[
#       "http://localhost:3000",
#       "https://ynex3.mycafe24.com",
#   ],

# 변경 후 백엔드 재시작
pm2 restart payment-backend


================================================================================
[12] 최종 확인
================================================================================

# 1. 백엔드 API 확인
curl https://ynex3.mycafe24.com/api/dashboard

# 2. 브라우저에서 접속
https://ynex3.mycafe24.com

# 3. PM2 상태 확인
pm2 status

# 4. 로그 확인
pm2 logs payment-frontend
pm2 logs payment-backend


================================================================================
[13] 유용한 명령어
================================================================================

# 앱 재시작
pm2 restart all

# 앱 중지
pm2 stop all

# 앱 삭제
pm2 delete all

# 로그 실시간 보기
pm2 logs --lines 100

# Nginx 재시작
sudo systemctl restart nginx

# Nginx 로그 확인
sudo tail -f /var/log/nginx/error.log

# SSL 인증서 수동 갱신
sudo certbot renew

# 시스템 리소스 확인
htop
df -h
free -h


================================================================================
[14] 문제 해결
================================================================================

### 502 Bad Gateway
- PM2가 실행 중인지 확인: pm2 status
- 백엔드 로그 확인: pm2 logs payment-backend
- 포트 확인: sudo netstat -tlnp | grep -E '3000|8000'

### SSL 인증서 오류
- 도메인이 서버 IP를 가리키는지 확인
- certbot 재실행: sudo certbot --nginx -d ynex3.mycafe24.com

### 문자 발송 실패
- .env 파일 내용 확인: cat /var/www/payment-sms/backend/.env
- 백엔드 로그 확인: pm2 logs payment-backend

### 메모리 부족
- PM2 메모리 확인: pm2 monit
- 불필요한 프로세스 종료

### npm run build 메모리 부족
- NODE_OPTIONS=--max_old_space_size=1024 npm run build

### SQLite DB 권한 오류
- chmod 664 /var/www/payment-sms/backend/payment.db
- chmod 775 /var/www/payment-sms/backend/


================================================================================
[15] 업데이트 배포
================================================================================

# 코드 업데이트 후
cd /var/www/payment-sms

# 프론트엔드 업데이트
cd frontend
npm install
npm run build
pm2 restart payment-frontend

# 백엔드 업데이트
cd /var/www/payment-sms/backend
source venv/bin/activate
pip install -r requirements.txt
pm2 restart payment-backend


================================================================================
                              배포 완료!
================================================================================

접속 URL: https://ynex3.mycafe24.com
API URL: https://ynex3.mycafe24.com/api

================================================================================
