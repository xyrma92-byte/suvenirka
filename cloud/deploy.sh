#!/usr/bin/env bash
# Выкладка функций. Требуется yc CLI, профиль с ключом сервисного аккаунта suvenirka-deploy.
# RUNTIME_SA — сервисный аккаунт, от имени которого работает функция (см. README).
set -euo pipefail
cd "$(dirname "$0")/orders-fn"
rm -rf __pycache__
RUNTIME_SA="${RUNTIME_SA:-ajeh9bt8mhiaq0ghrskh}"
DB=/ru-central1/b1gui6tpg2dojooi7lhf/etn3b23935r9ld8jl68p
ENV="YDB_ENDPOINT=grpcs://ydb.serverless.yandexcloud.net:2135,YDB_DATABASE=$DB,SELLER_EMAIL=iptns@mail.ru,SMTP_USER=iptns@mail.ru,BACKUP_BUCKET=suvenirka-orders-backup-b1gofs,YDB_TIMEOUT=10,ALLOWED_ORIGINS=https://xyrma92-byte.github.io,${EXTRA_ENV:-}APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycbyVU_P-LuBRC8REX1ZmrTXOCrVpk4bYqFGHOKj5qD4fRafWtAW7nvQsTXxS_I7OXNbO3A/exec"
SECRET="environment-variable=MAILRU_APP_PASSWORD,name=suvenirka-mail,key=MAILRU_APP_PASSWORD"
for fn in ${ONLY:-suvenirka-orders suvenirka-orders-admin}; do
  entry=index.handler; [ "$fn" = suvenirka-orders-admin ] && entry=index.admin_handler
  extra=(); FENV="$ENV"
  if [ "$fn" = suvenirka-orders ]; then
    if [ "${USE_LOCKBOX:-0}" = 1 ]; then extra=(--secret "$SECRET")   # нужна роль lockbox.payloadViewer у RUNTIME_SA
    else : "${MAILRU_APP_PASSWORD:?нужен MAILRU_APP_PASSWORD в окружении}"; FENV="$ENV,MAILRU_APP_PASSWORD=$MAILRU_APP_PASSWORD"; fi
  fi
  yc serverless function version create --function-name "$fn" --runtime python312 --entrypoint "$entry" \
    --memory 256m --execution-timeout 60s --concurrency 1 --service-account-id "$RUNTIME_SA" \
    --environment "$FENV" "${extra[@]}" --source-path . --format json > /tmp/fnver.json || { cat /tmp/fnver.json; rm -f /tmp/fnver.json; exit 1; }; python3 -c "import json;d=json.load(open('/tmp/fnver.json'));print('$fn', d['id'], d['status'])"; rm -f /tmp/fnver.json
done
rm -f ~/.config/yandex-cloud/logs/*function_version_create* 2>/dev/null || true  # в логах yc остаётся окружение функции
