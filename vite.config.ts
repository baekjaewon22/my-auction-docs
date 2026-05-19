import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
	plugins: [react(), cloudflare()],
	server: {
		headers: {
			// Google Identity Services 팝업이 window.closed 등을 체크할 수 있도록 허용
			"Cross-Origin-Opener-Policy": "same-origin-allow-popups",
			"Content-Security-Policy": "frame-ancestors 'self' http://127.0.0.1:5173 http://127.0.0.1:5174;",
		},
	},
});
