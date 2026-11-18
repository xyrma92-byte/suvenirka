#!/usr/bin/env bash
# Закрытая функция рассылки КП. Пароль — только из Lockbox suvenirka-mail.
set -euo pipefail
cd "$(dirname "$0")/outreach-fn"; rm -rf __pycache__
yc serverless function get suvenirka-outreach >/dev/null 2>&1 || yc serverless function create --name suvenirka-outreach --description "Рассылка КП (закрытая, только IAM)" >/dev/null
yc serverless function version create --function-name suvenirka-outreach --runtime python312 --entrypoint outreach.handler \
  --memory 256m --execution-timeout 600s --concurrency 1 --service-account-id "${RUNTIME_SA:-aje0u5c3m3dps0fta3ra}" \
  --environment "SMTP_USER=iptns@mail.ru,FROM_NAME=Никита,BACKUP_BUCKET=suvenirka-orders-backup-b1gofs,MAX_PER_CALL=60,TRACK_URL=https://functions.yandexcloud.net/d4e8gfk3k2te99udnmke,CAMPAIGN=kp_metal_2026_11" \
  --secret "environment-variable=MAILRU_APP_PASSWORD,name=suvenirka-mail,key=MAILRU_APP_PASSWORD" \
  --source-path . --format json | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['id'],d['status'])"
rm -f ~/.config/yandex-cloud/logs/*function_version_create* 2>/dev/null || true
