import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 개발 중에는 /api 요청을 Spring Boot(8080)로 넘겨서 같은 도메인처럼 동작하게 해요.
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
