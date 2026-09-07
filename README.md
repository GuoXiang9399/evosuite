# EvoSuite — 进化与流病分析一体化桌面平台（MVP）

> 第一周里程碑目标：**以「外壳 + 可视化」为核心，初步替代 MEGA 的序列→比对→建树→可视化核心闭环**。
> 形态为 **Tauri 原生桌面应用**（Rust + 系统 WebView），离线优先、隐私友好；算法引擎可接入 MAFFT / IQ-TREE2。

## 功能覆盖（本版本）

| 模块 | 能力 |
|---|---|
| 工作台 | 示例数据一键载入、工作流引导 |
| 序列数据 | FASTA 导入（粘贴/文件）、序列统计表、编辑、导出 |
| 多序列比对 | 内置轻量渐进比对（引导树 NJ + Needleman-Wunsch profile 对齐）；检测到 MAFFT 时优先调用 |
| 建树分析 | 替换模型 p-距离 / JC69 / K80；方法 NJ（邻接法）/ UPGMA |
| 系统发育树 | 交互式矩形/圆形树，滚轮缩放、拖拽平移、按 clade 配色、支持值、导出 SVG/PNG/Newick |
| 距离矩阵 | K80/JC69/p-distance 热力图矩阵，导出 CSV |
| 结果报告 | Markdown / HTML 报告，汇总项目与 Newick |

## 技术栈

- 前端：React 18 + TypeScript + Vite + Zustand
- 桌面壳：Tauri v2（Rust），产物为原生 exe/dmg/AppImage
- 算法：全部在前端 TS 实现（FASTA 解析、距离矩阵、NJ/UPGMA、Newick、树布局、比对），保证离线端到端可跑通；真实引擎经 `src-tauri/src/commands.rs` 接入，未安装时自动降级

## 运行方式

### 1. 开发预览（浏览器，最快验证外壳/可视化）
```bash
pnpm install
pnpm dev          # 打开 http://localhost:5173
```

### 2. 桌面应用（Tauri，需在本机执行）
```bash
pnpm install
pnpm tauri dev            # 开发模式原生窗口
pnpm tauri build          # 产出安装包（首次需系统依赖：Linux 需 webkit2gtk/webkit2gtk-4.1 等）
```
> Windows 直接产出 `.exe`/`.msi`；macOS 需先 `pnpm tauri icon` 生成 icns。

### 可选：接入真实引擎（提升比对/建树质量）
- 安装 [MAFFT](https://mafft.cbrc.jp/) → 比对自动优先调用
- 安装 [IQ-TREE2](http://www.iqtree.org/) → 建树 ML 模式可接入（当前 MVP 建树走内置 NJ/UPGMA，ML 命令已预留）

## 目录结构
```
src/
  lib/        算法与数据层（fasta / distance / tree / newick / layout / align / analysis / sample / tauri）
  components/  GUI 视图与外壳（Home / Sequences / Align / Build / TreeView / DistanceView / Report / Sidebar / LogPanel）
  store.ts    全局状态（Zustand）
  App.tsx      应用骨架（顶栏 + 侧栏 + 主内容 + 日志）
src-tauri/    Rust 后端（文件/外部引擎接入）
```

## 已验证（自动化测试）
- 解析→K80 距离→NJ/UPGMA→Newick 解析 全链路正确，示例灵长类数据安全保留
- 内置渐进比对不破坏序列内容（去 gap 等于原序列）、等宽
- 矩形/圆形树布局坐标有限、叶子数正确
- 前端 `vite build` 通过；全部视图组件可无异常渲染
