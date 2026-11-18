# Приём заказов в Яндекс Облаке (152-ФЗ)

Схема: сайт → функция `suvenirka-orders` (Россия) → 1) полный заказ в YDB `suvenirka-orders`
(резерв: приватный бакет Object Storage `suvenirka-orders-backup-b1gofs`, папка `pending/`, если YDB не ответила)
→ 2) счёт PDF + письмо покупателю и письмо продавцу через smtp.mail.ru:465 от iptns@mail.ru
→ 3) заказ **без личных данных** в Apps Script (`source: 'cloud'`) — брони, склад, статусы в Google-таблице.

| Что | ID |
|---|---|
| Облако / каталог | `b1gui6tpg2dojooi7lhf` / `b1gofsuaf5elvjq1d0i4` |
| YDB serverless `suvenirka-orders` | `etn3b23935r9ld8jl68p`, таблицы `orders`, `consents` |
| Функция `suvenirka-orders` (публичная, для сайта) | `d4e8gfk3k2te99udnmke`, https://functions.yandexcloud.net/d4e8gfk3k2te99udnmke |
| Функция `suvenirka-orders-admin` (закрытая, только IAM) | `d4eigapvhbeas2pp1pq0` |
| Бакет-резерв (приватный) | `suvenirka-orders-backup-b1gofs` |
| Секрет Lockbox `suvenirka-mail` | `e6q9oti9jdsmhm55llji` (ключ `MAILRU_APP_PASSWORD`) |
| SA для выкладки | `suvenirka-deploy` `ajeh9bt8mhiaq0ghrskh` (editor) |
| SA для работы функции (целевой) | `suvenirka-orders-fn` `aje0u5c3m3dps0fta3ra` |

## Выкладка

```bash
export MAILRU_APP_PASSWORD=...        # только из окружения, не в коде
./deploy.sh                           # обе функции
ONLY=suvenirka-orders ./deploy.sh     # одна
# когда у suvenirka-orders-fn будут роли (см. ниже):
RUNTIME_SA=aje0u5c3m3dps0fta3ra USE_LOCKBOX=1 ./deploy.sh
```

Роли, которые нужно выдать владельцу облака (у `suvenirka-deploy` роль `editor`, она не умеет выдавать доступ):
- публичный вызов функции для сайта: `yc serverless function allow-unauthenticated-invoke suvenirka-orders`
  (или в консоли: функция → «Публичная функция»);
- `suvenirka-orders-fn`: `ydb.editor` на каталог, `lockbox.payloadViewer` на секрет `suvenirka-mail`, `storage.uploader` + `storage.viewer` на каталог.

## Админ-функция (вызов с IAM-токеном)

```bash
TOKEN=$(yc iam create-token)
curl -H "Authorization: Bearer $TOKEN" -d '{"action":"get","id":"ZK-..."}' https://functions.yandexcloud.net/d4eigapvhbeas2pp1pq0
```
Действия: `ping`, `diag`, `schema`, `count`, `list`, `get`, `delete`, `backup_list`, `backup_get`, `backup_delete`, `sync` (перенос резерва в YDB).

## Переключение сайта

Ветка `cloud-orders`: в `config.js` задан `ordersApiUrl`, в `app.js` заказ уходит в функцию (резерв — форма в iframe на тот же адрес).
Переключение = слить ветку в `main`. Откат = `ordersApiUrl: ""`.
