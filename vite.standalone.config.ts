import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 单文件导出配置：整个应用（JS + CSS）合并并内联进一个 HTML。
// 产物可经 file:// 双击直接打开（无需 dev server / Tauri 运行时）。
// 用法：node_modules/.bin/vite build --config vite.standalone.config.ts
export default defineConfig({
  root: '/workspace/evosuite',
  plugins: [react()],
  clearScreen: false,
  base: './',
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2021',
    outDir: '/tmp/evosuite_standalone',
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // 合并所有动态导入为单 chunk，消除 file:// 下无法加载的分块文件
        inlineDynamicImports: true,
      },
    },
  },
})
