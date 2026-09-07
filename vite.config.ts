import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri 期望固定端口与宽松配置；沙箱内用 Web 预览验证外壳与可视化
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: true,
    port: 1420,
    strictPort: false,
  },
  // 允许在纯浏览器（无 Tauri 运行时）下直接运行，便于沙箱预览
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2021',
    outDir: 'dist',
    emptyOutDir: true,
  },
})
