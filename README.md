# EvoSuite — 分子进化与系统发育分析一体化桌面平台

> MEGA 类软件的开源替代探索：序列 → 比对 → 分析 → 建树 → 贝叶斯 → 报告全流程离线桌面应用。
> 形态为 **Tauri v2 原生桌面应用**（Rust + 系统 WebView），离线优先、隐私友好。

## 功能总览

| 模块 | 能力 |
|---|---|
| 工作台 | 示例数据一键载入、5 步工作流引导 |
| 序列数据 | FASTA 导入（粘贴/文件）、表格化对齐编辑器（列名 + sticky 列）、导出 |
| 多序列比对 | 内置渐进比对（引导树 NJ + profile 对齐）；检测到 MAFFT 时优先调用 |
| Seq Analyze | Base Composition（左图右表）、Models（BIC/AICc/AIC 模型选择排名）、Distance（10 核酸 + 7 氨基酸模型热力矩阵）、Diversity（π/θw/Tajima's D/Hd）、Codon（RSCU 左表右图 + dN/dS Z-test 可视化） |
| 建树分析 | 6 引擎选择（内置 NJ/UPGMA、IQ-TREE2、RAxML-NG、MrBayes、BEAST1、BEAST2）；Bootstrap、Γ/不变位点、成对/完全删除；结果到 Tree View 查看 |
| 系统发育树 | FigTree 式矩形/圆形/放射三布局、直角折线、侧栏 5 面板（外观/标签/比例尺）、中点根化、梯状化、导出 SVG/PNG/Newick/NEXUS |
| 贝叶斯高级 | 按引擎（BEAST1/BEAST2/内置）独立管理天际线 + 系统动态结果；MCMC 日志摘要；Ne/R0/TMRCA/增长率 |
| 结果报告 | Markdown / HTML 报告，汇总项目与 Newick |

## 技术栈

- 前端：React 18 + TypeScript + Vite 5 + Zustand（中英双语 i18n）
- 桌面壳：Tauri v2（Rust），产物为原生 exe / dmg / AppImage
- 算法：全部在前端 TS 实现（FASTA 解析、距离矩阵、NJ/UPGMA、模型选择、多样性、密码子分析、树布局、比对），保证离线端到端可跑通；真实引擎经 `src-tauri/src/commands.rs` 接入（MAFFT / IQ-TREE2 / BEAST1 / BEAST2），未安装时自动降级

## 开发

### 1. Web 预览（浏览器，最快验证外壳/可视化）
```bash
pnpm install
pnpm dev          # 打开 http://localhost:5173
```

### 2. 桌面应用（Tauri）
```bash
pnpm install
pnpm tauri dev    # 开发模式原生窗口
pnpm tauri build  # 产出安装包
```

Linux 首次构建需系统依赖：
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Windows 直接产出 `.exe`/`.msi`（构建指南见 `docs/windows_build_guide.html`）；macOS 需先 `pnpm tauri icon` 生成 icns。

### 3. 可选：接入真实引擎（提升比对/建树质量）
- 安装 [MAFFT](https://mafft.cbrc.jp/) → 比对自动优先调用
- 安装 [IQ-TREE2](http://www.iqtree.org/) → ML 建树接入
- 安装 [BEAST1](https://beast.community/beast1) / BEAST2 → 贝叶斯天际线真实 MCMC

## 目录结构

```
src/
  components/   GUI 视图（Home / Sequences / Analyze / Build / TreeView / AdvancedResult / Report / ...）
  lib/          算法与数据层（fasta / distance / newick / layout / stats / codon / modelselect / beast / align）
  i18n.ts       中英词典
  store.ts      全局状态（Zustand）
src-tauri/      Rust 后端（commands.rs：run_mafft / run_iqtree / run_beast / ...）
sample/         示例数据
scripts/        算法测试脚本
docs/           构建指南
```

## 已验证（自动化测试）

- 解析→K80 距离→NJ/UPGMA→Newick 解析全链路正确
- 内置渐进比对不破坏序列内容、等宽
- 矩形/圆形/放射树布局坐标有限、叶子数正确
- Diversity（Tajima's D 方差）、Codon（Nei-Gojobori Z-test）数值与文献口径一致
- 前端 `tsc --noEmit` + `vite build` 通过；Playwright 全视图零报错回归
