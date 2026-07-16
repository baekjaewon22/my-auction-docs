/**
 * 커스텀 환경 바인딩 타입 정의
 * - wrangler.json의 bindings/vars와 동기화 필요
 * - 자동 생성 타입(worker-configuration.d.ts)과 별도 관리
 */
declare namespace Cloudflare {
	interface Env {
		/** D1 데이터베이스 바인딩 */
		DB: D1Database;
		/** R2 bucket for externally uploaded article PDFs */
		ARTICLE_BUCKET: R2Bucket;
		/** 현재 배포 환경 (dev/staging/production에서 자동 주입) */
		ENVIRONMENT: "development" | "staging" | "production";
		/** Space-separated origins allowed to embed admin pages, e.g. https://all-for-one.example.com */
		ALL_FOR_ONE_FRAME_ANCESTORS?: string;
		/** JWT signing secret (Wrangler secret, at least 32 characters) */
		JWT_SIGNING_SECRET: string;
		/** Web Push VAPID configuration (Wrangler secrets) */
		VAPID_PUBLIC_KEY?: string;
		VAPID_PRIVATE_KEY?: string;
		VAPID_SUBJECT?: string;
		/** Slack incoming webhook for room reservation notifications */
		SLACK_ROOM_RESERVATION_WEBHOOK_URL?: string;
		/** Shared Slack incoming webhook fallback */
		SLACK_WEBHOOK_URL?: string;
		/** NCP SENS 알림톡 (시크릿으로 등록) */
		NCP_ACCESS_KEY: string;
		NCP_SECRET_KEY: string;
		NCP_SERVICE_ID: string;
		NCP_KAKAO_CHANNEL_ID: string;
	}
}

interface Env extends Cloudflare.Env {}
