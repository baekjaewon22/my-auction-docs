import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
	plugins: [react(), cloudflare()],
	server: {
		headers: {
			// Google Identity Services 팝업이 window.closed 등을 체크할 수 있도록 허용
			"Cross-Origin-Opener-Policy": "same-origin-allow-popups",
		},
	},
});
