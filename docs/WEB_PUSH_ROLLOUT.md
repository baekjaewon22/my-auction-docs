# 웹푸시 운영 적용 순서

웹푸시는 사용자가 프로필에서 직접 기기 알림을 허용한 경우에만 작동한다. 1차 적용에서는 구독, 해제, 본인 시험 발송과 마스터 진단만 제공하며 업무 이벤트 자동 발송은 연결하지 않는다.

## 적용 전 확인

1. 운영 D1 백업 또는 복구 지점을 확보한다.
2. `d1/migrate-web-push.sql`을 운영 D1에 적용한다.
3. 적용 후 아래 테이블이 존재하는지 확인한다.
   - `web_push_subscriptions`
   - `web_push_delivery_logs`
   - `web_push_subscription_audit`

## 운영 Secret

다음 값은 `.env`나 Git에 저장하지 않고 Wrangler Secret으로만 입력한다.

```powershell
npx.cmd web-push generate-vapid-keys
npx.cmd wrangler secret put JWT_SIGNING_SECRET
npx.cmd wrangler secret put VAPID_PUBLIC_KEY
npx.cmd wrangler secret put VAPID_PRIVATE_KEY
npx.cmd wrangler secret put VAPID_SUBJECT
```

- `JWT_SIGNING_SECRET`: 임의 생성한 32자 이상의 비밀 문자열
- `VAPID_SUBJECT`: 회사가 관리하는 이메일 주소를 `mailto:주소` 형식으로 입력
- 새 JWT Secret을 적용하면 기존 로그인 토큰은 만료되므로 배포 후 한 번 다시 로그인해야 한다.
- VAPID Secret이 하나라도 빠지면 프로필에는 “서버 알림키 미설정”으로 표시되고 시험 발송은 실행되지 않는다.

## 배포 전 검증

```powershell
npm.cmd run test:web-push
npm.cmd run test:web-push:workerd
npm.cmd run build
npx.cmd wrangler deploy --dry-run
```

`test:web-push:workerd`는 Node 테스트가 아니라 로컬 workerd에서 실제 `webpush.sendNotification` 암호화·VAPID·HTTPS 경로를 실행하고, 푸시 서비스의 HTTP 응답까지 도달하는지 확인한다.

배포 후에는 마스터 계정과 일반 사용자 계정으로 각각 확인한다.

1. 프로필에서 이 기기 알림 연결
2. 브라우저 권한 허용
3. 시험 알림 보내기
4. 사이트 탭을 닫은 상태에서 알림 수신 확인
5. 마스터 계정에서 웹푸시 통합진단의 성공/실패 기록 확인
6. 알림 연결 해제 후 더 이상 시험 알림이 발송되지 않는지 확인
