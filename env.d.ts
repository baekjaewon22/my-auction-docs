/**
 * 커스텀 환경 바인딩 타입 정의
 * - wrangler.json의 bindings/vars와 동기화 필요
 * - 자동 생성 타입(worker-configuration.d.ts)과 별도 관리
 */
declare namespace Cloudflare {
	interface Env {
		/** D1 데이터베이스 바인딩 */
		DB: D1Database;
		/** 현재 배포 환경 (dev/staging/production에서 자동 주입) */
		ENVIRONMENT: "development" | "staging" | "production";
		/** Resend 이메일 API Key */
		RESEND_API_KEY: string;
	}
}

interface Env extends Cloudflare.Env {}
