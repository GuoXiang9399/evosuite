// 外部引擎接入命令：MAFFT（比对）、IQ-TREE2（最大似然建树）、BEAST1/2（贝叶斯）。
// 若系统未安装对应二进制，命令返回 Err，前端自动回退到内置轻量算法。
//
// v0.1.1：
//   - Engines 一键下载安装：下载官方发布包并解压到「软件文件夹/engines/<id>/」，
//     本地引擎优先于 PATH 中的同名命令；
//   - Workspace 默认位于「软件文件夹/workspace/」；
//   - BEAST1 参数按 BEAUti 分类逻辑：树先验 / 位点模型 / 分子钟 / MCMC。
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(serde::Deserialize)]
pub struct SeqInput {
    pub name: String,
    pub sequence: String,
}

fn write_fasta(sequences: &[SeqInput], path: &std::path::Path) -> std::io::Result<()> {
    let mut f = std::fs::File::create(path)?;
    for s in sequences {
        writeln!(f, ">{}", s.name)?;
        for chunk in s.sequence.as_bytes().chunks(60) {
            f.write_all(chunk)?;
            writeln!(f)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 应用目录：引擎与工作区都放在「软件自身文件夹」内
// ---------------------------------------------------------------------------

/// 软件文件夹定位策略：
/// 1) 可执行文件所在目录可写（绿色版 / 解压版 / Windows per-user 安装）→ 软件文件夹
/// 2) 只读安装位置（Linux /usr/bin、AppImage squashfs 挂载点、Program Files）
///    → 回退到用户主目录 ~/EvoSuite，保证 engines/ 与 workspace/ 始终可用
fn app_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir_writable(dir) {
                return dir.to_path_buf();
            }
        }
    }
    home_fallback()
}

/// 探测目录是否可写：尝试创建并删除一个临时探针文件。
fn dir_writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(format!(".evosuite_w_{}", std::process::id()));
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 只读安装位置的回退：~/EvoSuite（无 HOME 时用系统临时目录）。
fn home_fallback() -> PathBuf {
    match std::env::var_os("HOME") {
        Some(h) => PathBuf::from(h).join("EvoSuite"),
        None => std::env::temp_dir(),
    }
}

fn engines_root() -> PathBuf {
    app_dir().join("engines")
}

fn workspace_root() -> PathBuf {
    app_dir().join("workspace")
}

// ---------------------------------------------------------------------------
// 引擎包定义（一键安装）
// ---------------------------------------------------------------------------

/// 每个引擎在当前平台的一键安装来源。
/// 返回 (下载 URL, 包格式 "zip"|"tgz", 是否需要系统 Java)。
fn engine_pkg(id: &str) -> Option<(&'static str, &'static str, bool)> {
    match (id, cfg!(target_os = "windows")) {
        // BEAST1 v1.10.4：Java 包（Windows/Linux 通用 zip），需要系统 Java 8+
        ("beast1", _) => Some((
            "https://github.com/beast-dev/beast-mcmc/releases/download/v1.10.4/BEAST.v1.10.4.zip",
            "zip",
            true,
        )),
        // BEAST2 v2.7.7：Windows 包自带 JRE；Linux 包需系统 Java
        ("beast2", true) => Some((
            "https://github.com/CompEvol/beast2/releases/download/v2.7.7/BEAST.v2.7.7.Windows.zip",
            "zip",
            false,
        )),
        ("beast2", false) => Some((
            "https://github.com/CompEvol/beast2/releases/download/v2.7.7/BEAST.v2.7.7.Linux.x86.tgz",
            "tgz",
            true,
        )),
        // IQ-TREE2 v2.4.0：原生二进制
        ("iqtree2", true) => Some((
            "https://github.com/iqtree/iqtree2/releases/download/v2.4.0/iqtree-2.4.0-Windows.zip",
            "zip",
            false,
        )),
        ("iqtree2", false) => Some((
            "https://github.com/iqtree/iqtree2/releases/download/v2.4.0/iqtree-2.4.0-Linux-intel.tar.gz",
            "tgz",
            false,
        )),
        // MrBayes 3.2.7：Windows 官方包（Linux 建议系统包管理器安装）
        ("mrbayes", true) => Some((
            "https://github.com/NBISweden/MrBayes/releases/download/v3.2.7/MrBayes-3.2.7-WIN.zip",
            "zip",
            false,
        )),
        // RAxML-NG：仅 Linux 提供官方预编译（Windows 无官方包）
        ("raxmlng", false) => Some((
            "https://github.com/amkozlov/raxml-ng/releases/download/2.0.3/raxml-ng_v2.0.3_linux_x86_64.zip",
            "zip",
            false,
        )),
        _ => None,
    }
}

/// 检查本地 engines/<id>/ 是否为有效安装（特征文件存在）。
fn engine_local_dir(id: &str) -> Option<PathBuf> {
    let root = engines_root().join(id);
    let ok = match id {
        "beast1" => root.join("lib").join("beast.jar").exists(),
        "beast2" => root.join("lib").join("launcher.jar").exists(),
        "iqtree2" => {
            root.join("bin")
                .join(if cfg!(target_os = "windows") { "iqtree2.exe" } else { "iqtree2" })
                .exists()
        }
        // MrBayes 的可执行文件带版本号（mb.3.2.7-win64.exe）
        "mrbayes" => root
            .join("bin")
            .read_dir()
            .map(|rd| {
                rd.filter_map(|e| e.ok()).any(|e| {
                    let n = e.file_name().to_string_lossy().to_lowercase();
                    n.starts_with("mb.") && n.ends_with(".exe")
                })
            })
            .unwrap_or(false),
        "raxmlng" => root
            .join("bin")
            .join(if cfg!(target_os = "windows") { "raxml-ng.exe" } else { "raxml-ng" })
            .exists(),
        "mafft" => {
            root.join("mafft.bat").exists() || root.join("bin").join("mafft").exists()
        }
        _ => false,
    };
    if ok {
        Some(root)
    } else {
        None
    }
}

/// 本地安装版本显示（简单读取版本文件 / 目录约定）。
fn local_version_label(id: &str) -> String {
    match id {
        "beast1" => "1.10.4".into(),
        "beast2" => {
            let v = std::fs::read_to_string(engines_root().join("beast2").join("VERSION"))
                .unwrap_or_default();
            let v = v.trim().to_string();
            if v.is_empty() { "2.7.7".into() } else { v }
        }
        "iqtree2" => "2.4.0".into(),
        "mrbayes" => "3.2.7".into(),
        "raxmlng" => "2.0.3".into(),
        _ => "".into(),
    }
}

fn java_available() -> bool {
    Command::new("java")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 下载并解压到临时目录后，把（唯一的）顶层目录内容提升为 engines/<id>/。
#[tauri::command]
pub fn install_engine(id: String) -> Result<EngineInstallResult, String> {
    let (url, kind, needs_java) =
        engine_pkg(&id).ok_or_else(|| {
            "该引擎在当前平台暂无官方一键安装包，请点击「下载页」手动安装".to_string()
        })?;

    // 1. 下载到临时文件
    let tmp = std::env::temp_dir();
    let archive = tmp.join(format!("evosuite_eng_{}.{}", id, kind));
    let mut resp = reqwest::blocking::get(url)
        .map_err(|e| format!("下载失败：{e}"))?;
    {
        let mut f = std::fs::File::create(&archive)
            .map_err(|e| format!("写临时文件失败：{e}"))?;
        resp.copy_to(&mut f)
            .map_err(|e| format!("保存下载内容失败：{e}"))?;
    }

    // 2. 解压到临时目录（zip 用 zip crate；tgz 用系统 tar）
    let extract_dir = tmp.join(format!("evosuite_eng_{}_x", id));
    let _ = std::fs::remove_dir_all(&extract_dir);
    std::fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("创建解压目录失败：{e}"))?;
    if kind == "zip" {
        unzip(&archive, &extract_dir)?;
    } else {
        let out = Command::new("tar")
            .arg("-xzf")
            .arg(&archive)
            .arg("-C")
            .arg(&extract_dir)
            .output()
            .map_err(|e| format!("解压失败（tar）：{e}"))?;
        if !out.status.success() {
            return Err(format!(
                "解压失败：{}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
    }

    // 3. 唯一顶层目录 → 内容提升
    let src = single_top_dir(&extract_dir).unwrap_or_else(|| extract_dir.clone());
    let dest = engines_root().join(&id);
    std::fs::create_dir_all(engines_root())
        .map_err(|e| format!("创建引擎目录失败：{e}"))?;
    let _ = std::fs::remove_dir_all(&dest);
    // rename 跨设备会失败，回退到递归复制
    if std::fs::rename(&src, &dest).is_err() {
        copy_dir_all(&src, &dest)?;
    }
    let _ = std::fs::remove_dir_all(&extract_dir);
    let _ = std::fs::remove_file(&archive);

    // 4. 验证特征文件
    if engine_local_dir(&id).is_none() {
        return Err("安装完成但未找到特征文件（发布包结构可能已变化）".into());
    }

    let mut warning = String::new();
    if needs_java && !java_available() {
        warning = "已安装，但未检测到 Java 运行时（该引擎需要 Java 8+，请先安装 Java）".into();
    }
    Ok(EngineInstallResult {
        path: dest.to_string_lossy().to_string(),
        version: local_version_label(&id),
        warning,
    })
}

#[derive(serde::Serialize)]
pub struct EngineInstallResult {
    pub path: String,
    pub version: String,
    pub warning: String,
}

fn unzip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let f = std::fs::File::open(zip_path).map_err(|e| format!("打开压缩包失败：{e}"))?;
    let mut ar = zip::ZipArchive::new(f).map_err(|e| format!("读取压缩包失败：{e}"))?;
    ar.extract(dest).map_err(|e| format!("解压失败：{e}"))
}

/// 若目录下只有一个条目且为目录，返回该目录（解压包的顶层包装目录）。
fn single_top_dir(dir: &Path) -> Option<PathBuf> {
    let mut rd = std::fs::read_dir(dir).ok()?;
    let first = rd.next()?.ok()?;
    if rd.next().is_some() {
        return None; // 多个条目：解压根即内容
    }
    if first.file_type().ok()?.is_dir() {
        Some(first.path())
    } else {
        None
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("创建目录失败：{e}"))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("读目录失败：{e}"))? {
        let entry = entry.map_err(|e| format!("读目录失败：{e}"))?;
        let ty = entry.file_type().map_err(|e| format!("读文件类型失败：{e}"))?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to).map_err(|e| format!("复制文件失败：{e}"))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 引擎检测：本地 engines/ 优先，其次 PATH
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct EngineInfo {
    pub status: String, // "installed" | "missing"
    pub version: String,
    pub path: String,
}

fn detect_binary(bin: &str, flag: &str) -> Option<(String, String)> {
    let out = Command::new(bin).arg(flag).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let version = text.lines().find(|l| !l.trim().is_empty())?.trim().to_string();
    if version.is_empty() {
        None
    } else {
        let resolved = Command::new(if cfg!(target_os = "windows") { "where" } else { "which" })
            .arg(bin)
            .output()
            .ok()
            .and_then(|o| {
                let p = String::from_utf8_lossy(&o.stdout);
                p.lines().next().map(|s| s.trim().to_string())
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| bin.to_string());
        Some((version, resolved))
    }
}

#[tauri::command]
pub fn detect_engines() -> HashMap<String, EngineInfo> {
    let targets: &[(&str, &str, &str)] = &[
        ("mafft", "mafft", "--version"),
        ("iqtree2", "iqtree2", "--version"),
        ("raxmlng", "raxml-ng", "--version"),
        ("mrbayes", "mb", "--version"),
        ("beast1", "beast", "-version"),
        ("beast2", "beast", "-version"),
    ];
    let mut map = HashMap::new();
    for (id, bin, flag) in targets {
        // 1) 本地 engines/<id>/
        if let Some(root) = engine_local_dir(id) {
            map.insert(
                id.to_string(),
                EngineInfo {
                    status: "installed".into(),
                    version: local_version_label(id),
                    path: root.to_string_lossy().to_string(),
                },
            );
            continue;
        }
        // 2) 系统 PATH
        if let Some((version, path)) = detect_binary(bin, flag) {
            map.insert(
                id.to_string(),
                EngineInfo {
                    status: "installed".into(),
                    version,
                    path,
                },
            );
        } else {
            map.insert(
                id.to_string(),
                EngineInfo {
                    status: "missing".into(),
                    version: String::new(),
                    path: String::new(),
                },
            );
        }
    }
    map
}

/// 打开官方下载页（一键安装不可用时的回退）。
#[tauri::command]
pub fn download_engine(id: String) -> Result<EngineUrl, String> {
    let url = match id.as_str() {
        "mafft" => "https://mafft.cbrc.jp/alignment/software/",
        "iqtree2" => "http://www.iqtree.org/",
        "raxmlng" => "https://github.com/amkozlov/raxml-ng",
        "mrbayes" => "https://nbisweden.github.io/MrBayes/",
        "beast1" => "https://beast.community/",
        "beast2" => "https://www.beast2.org/",
        _ => return Err(format!("未知内核：{id}")),
    };
    Ok(EngineUrl { url: url.to_string() })
}

#[derive(serde::Serialize)]
pub struct EngineUrl {
    pub url: String,
}

// ---------------------------------------------------------------------------
// Workspace：默认位于软件文件夹内，支持列出/保存结果文件
// ---------------------------------------------------------------------------

/// 返回默认工作区（软件文件夹/workspace），不存在则创建。
#[tauri::command]
pub fn default_workspace() -> Result<String, String> {
    let ws = workspace_root();
    std::fs::create_dir_all(&ws).map_err(|e| format!("创建工作区失败：{e}"))?;
    Ok(ws.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
pub struct WorkspaceFile {
    pub name: String,
    pub size: u64,
    pub modified: String,
}

/// 列出工作区中的结果文件（名称 / 大小 / 修改时间）。
/// workspace 为 None 时使用默认工作区。
#[tauri::command]
pub fn list_workspace_files(workspace: Option<String>) -> Result<Vec<WorkspaceFile>, String> {
    let dir = workspace
        .filter(|w| !w.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(workspace_root);
    let mut out = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| format!("读工作区失败：{e}"))?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH));
    for e in entries {
        let md = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| format_unix_time(d.as_secs()))
            .unwrap_or_default();
        let name = e.file_name().to_string_lossy().to_string();
        out.push(WorkspaceFile {
            name,
            size: md.len(),
            modified,
        });
    }
    Ok(out)
}

fn format_unix_time(secs: u64) -> String {
    // 简易 UTC 时间格式化（YYYY-MM-DD HH:MM），避免引入 chrono
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // 1970-01-01 起的天数 → 年月日（civil_from_days 算法）
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, m, d, h, mi, s)
}

/// 把结果文件写入工作区（文件名做安全过滤，防路径穿越）。
#[tauri::command]
pub fn save_workspace_file(
    workspace: Option<String>,
    filename: String,
    content: String,
) -> Result<String, String> {
    let dir = workspace
        .filter(|w| !w.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(workspace_root);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建工作区失败：{e}"))?;
    let safe: String = filename
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
        .collect();
    if safe.trim().is_empty() {
        return Err("文件名无效".into());
    }
    let p = dir.join(safe);
    std::fs::write(&p, content).map_err(|e| format!("写入文件失败：{e}"))?;
    Ok(p.to_string_lossy().to_string())
}

/// 读取工作区中的结果文件内容（文件名做安全过滤，防路径穿越）。
#[tauri::command]
pub fn read_workspace_file(
    workspace: Option<String>,
    filename: String,
) -> Result<String, String> {
    let dir = workspace
        .filter(|w| !w.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(workspace_root);
    let safe: String = filename
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
        .collect();
    if safe.trim().is_empty() {
        return Err("文件名无效".into());
    }
    let p = dir.join(&safe);
    // 拒绝目录与超过 5MB 的大文件（结果文件均为文本）
    let md = std::fs::metadata(&p).map_err(|e| format!("读取文件信息失败：{e}"))?;
    if md.is_dir() {
        return Err("该条目是目录".into());
    }
    if md.len() > 5 * 1024 * 1024 {
        return Err("文件过大（>5MB），请用系统文件管理器打开".into());
    }
    std::fs::read_to_string(&p).map_err(|e| format!("读取文件失败：{e}"))
}

// ---------------------------------------------------------------------------
// BEAST 结果结构
// ---------------------------------------------------------------------------

/// BEAST1 贝叶斯推断结果（天际线）。
#[derive(serde::Serialize)]
pub struct BeastResult {
    pub model: String,
    pub groups: i64,
    pub times: Vec<f64>,
    pub ne: Vec<f64>,
    pub from_engine: bool,
}

/// BEAST1 系统动态（phylodynamics）推断结果。
#[derive(serde::Serialize)]
pub struct BeastPhylodynamicsResult {
    pub tmrca: f64,
    #[serde(rename = "growthRate")] pub growth_rate: f64,
    pub rate: f64,
    #[serde(rename = "R0")] pub r0: f64,
    #[serde(rename = "Ne0")] pub ne0: f64,
    pub times: Vec<f64>,
    #[serde(rename = "coalescentRate")] pub coalescent_rate: Vec<f64>,
    pub from_engine: bool,
}

// ---------------------------------------------------------------------------
// BEAST 启动命令构造：本地 engines/ 优先
// ---------------------------------------------------------------------------

/// 构造 BEAST 启动命令（本地 engines/<id>/ 优先于 PATH 的 beast）。
fn beast_command(engine: &str, xml: &Path) -> Command {
    let id = if engine == "beast2" { "beast2" } else { "beast1" };
    if let Some(root) = engine_local_dir(id) {
        if id == "beast1" {
            // BEAST1：java -jar lib/beast.jar（bin/beast.cmd 同款启动方式）
            let mut c = Command::new("java");
            c.arg("-jar").arg(root.join("lib").join("beast.jar")).arg(xml);
            return c;
        }
        #[cfg(target_os = "windows")]
        {
            // BEAST2 Windows 包自带 JRE：bat/beast.bat
            let bat = root.join("bat").join("beast.bat");
            if bat.exists() {
                let mut c = Command::new("cmd");
                c.arg("/C").arg(&bat).arg("-overwrite").arg(xml);
                return c;
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let sh = root.join("bin").join("beast");
            if sh.exists() {
                let mut c = Command::new("sh");
                c.arg(&sh).arg("-overwrite").arg(xml);
                return c;
            }
        }
    }
    let mut c = Command::new("beast");
    c.arg(xml);
    c
}

/// IQ-TREE2 启动命令（本地 engines/iqtree2/bin 优先）。
fn iqtree_command() -> Command {
    let bin = engines_root().join("iqtree2").join("bin").join(
        if cfg!(target_os = "windows") { "iqtree2.exe" } else { "iqtree2" },
    );
    if bin.exists() {
        Command::new(bin)
    } else {
        Command::new("iqtree2")
    }
}

// ---------------------------------------------------------------------------
// MAFFT / IQ-TREE2
// ---------------------------------------------------------------------------

/// 调用外部 MAFFT 进行多序列比对，返回 FASTA 文本。
#[tauri::command]
pub fn align_mafft(sequences: Vec<SeqInput>) -> Result<String, String> {
    if sequences.is_empty() {
        return Err("空序列".into());
    }
    let tmp = std::env::temp_dir().join("evosuite_mafft_in.fa");
    let out = std::env::temp_dir().join("evosuite_mafft_out.fa");
    write_fasta(&sequences, &tmp).map_err(|e| format!("写临时文件失败：{e}"))?;

    // 本地 engines/mafft 优先（Windows: mafft.bat）
    let mut cmd = {
        let local = engines_root().join("mafft");
        let bat = local.join("mafft.bat");
        if cfg!(target_os = "windows") && bat.exists() {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&bat);
            c
        } else {
            Command::new("mafft")
        }
    };
    let status = cmd.arg("--auto").arg(&tmp).output();

    match status {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let _ = std::fs::remove_file(&tmp);
            let _ = std::fs::remove_file(&out);
            if stdout.trim().starts_with('>') {
                Ok(stdout)
            } else {
                Err("MAFFT 输出格式异常".into())
            }
        }
        Ok(o) => Err(format!(
            "MAFFT 执行失败：{}",
            String::from_utf8_lossy(&o.stderr)
        )),
        Err(_) => Err("未检测到 MAFFT，请在内核管理中安装后重试".into()),
    }
}

/// 调用外部 IQ-TREE2 进行最大似然建树，返回 Newick 树。
#[tauri::command]
pub fn run_iqtree(fasta: String, model: String) -> Result<String, String> {
    let dir = std::env::temp_dir();
    let in_path = dir.join("evosuite_iq_in.fa");
    let prefix = dir.join("evosuite_iq");
    std::fs::write(&in_path, &fasta).map_err(|e| format!("写临时文件失败：{e}"))?;

    let model_arg = if model.is_empty() { "MFP" } else { model.as_str() };
    let status = iqtree_command()
        .arg("-s")
        .arg(&in_path)
        .arg("-m")
        .arg(model_arg)
        .arg("-T")
        .arg("1")
        .arg("-safe")
        .arg("--prefix")
        .arg(&prefix)
        .output();

    let treefile = dir.join("evosuite_iq.treefile");
    match status {
        Ok(o) if o.status.success() && treefile.exists() => {
            let nwk = std::fs::read_to_string(&treefile).unwrap_or_default();
            let _ = std::fs::remove_file(&in_path);
            let _ = std::fs::remove_file(&treefile);
            if nwk.contains('(') && nwk.contains(';') {
                Ok(nwk)
            } else {
                Err("IQ-TREE2 未产出有效树文件".into())
            }
        }
        Ok(o) => Err(format!(
            "IQ-TREE2 执行失败：{}",
            String::from_utf8_lossy(&o.stderr)
        )),
        Err(_) => Err("未检测到 IQ-TREE2，请在内核管理中安装后重试".into()),
    }
}

// ---------------------------------------------------------------------------
// BEAST1 接入辅助
// ---------------------------------------------------------------------------

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 解析 FASTA 文本为 (名称, 序列) 列表（已大写、去空白）。
fn parse_fasta(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut name = String::new();
    let mut seq = String::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('>') {
            if !name.is_empty() {
                out.push((std::mem::take(&mut name), std::mem::take(&mut seq)));
            }
            name = line[1..].trim().to_string();
        } else {
            let cleaned: String = line
                .chars()
                .filter(|c| !c.is_whitespace())
                .map(|c| c.to_ascii_uppercase())
                .collect();
            seq.push_str(&cleaned);
        }
    }
    if !name.is_empty() {
        out.push((name, seq));
    }
    out
}

/// 根据序列字母表判断是否为氨基酸数据。
fn is_aa(seqs: &[(String, String)]) -> bool {
    for (_, s) in seqs {
        for ch in s.chars() {
            let u = ch.to_ascii_uppercase();
            if u == '-' || u == '?' || u == 'X' {
                continue;
            }
            if !"ACGTU".contains(u) {
                return true;
            }
        }
    }
    false
}

/// 平均成对 p-distance（用于系统动态速率估算）。
fn avg_pdist(seqs: &[(String, String)]) -> f64 {
    if seqs.len() < 2 {
        return 0.02;
    }
    let minlen = seqs.iter().map(|(_, s)| s.len()).min().unwrap_or(0);
    if minlen == 0 {
        return 0.02;
    }
    let mut total = 0.0;
    let mut pairs = 0;
    for i in 0..seqs.len() {
        for j in (i + 1)..seqs.len() {
            let a = &seqs[i].1;
            let b = &seqs[j].1;
            let mut diff = 0;
            for k in 0..minlen {
                if a.as_bytes()[k] != b.as_bytes()[k] {
                    diff += 1;
                }
            }
            total += diff as f64 / minlen as f64;
            pairs += 1;
        }
    }
    if pairs == 0 {
        0.02
    } else {
        total / pairs as f64
    }
}

// ---------------------------------------------------------------------------
// BEAST1 XML 生成（v0.1.1：按 BEAUti 参数分类 —— 树先验/位点模型/分子钟/MCMC）
// ---------------------------------------------------------------------------

/// 生成 BEAST1 XML。参数：
///   tree_prior: "skyline" | "constant" | "exponential" | "yule" | "bd"
///   clock:      "strict" | "relaxed_ln" | "relaxed_exp"
///   subst:      "hky" | "gtr" | "jc"（氨基酸数据自动用 JTT）
///   gamma_cats: 0 = 不建模位点间速率异质性
///   pinv:      <0 = 不建模不变位点
fn generate_beast_xml(
    seqs: &[(String, String)],
    aa: bool,
    tree_prior: &str,
    clock: &str,
    subst: &str,
    gamma_cats: i64,
    pinv: f64,
    groups: i64,
    chain: i64,
    gen_time: f64,
    log_path: &Path,
) -> String {
    let g = groups.max(2) as usize;
    let datatype = if aa { "aminoacid" } else { "nucleotide" };

    // ---------- 位点模型：替换模型（HKY / GTR / JTT）----------
    let (subst_inner, mut state_nodes, mut operators) = if aa {
        (
            "          <jttModel id=\"substModel\"/>\n".to_string(),
            String::new(),
            String::new(),
        )
    } else {
        match subst {
            "gtr" => (
                "          <gtrModel id=\"substModel\">\n            <frequencies>\n              <frequencyModel spec=\"Frequencies\" dataType=\"nucleotide\">\n                <frequencies><parameter id=\"freqs\" value=\"0.25 0.25 0.25 0.25\"/></frequencies>\n              </frequencyModel>\n            </frequencies>\n            <rateAC><parameter id=\"rateAC\" value=\"1.0\" lower=\"0.0\"/></rateAC>\n            <rateAG><parameter id=\"rateAG\" value=\"1.0\" lower=\"0.0\"/></rateAG>\n            <rateAT><parameter id=\"rateAT\" value=\"1.0\" lower=\"0.0\"/></rateAT>\n            <rateCG><parameter id=\"rateCG\" value=\"1.0\" lower=\"0.0\"/></rateCG>\n            <rateGT><parameter id=\"rateGT\" value=\"1.0\" lower=\"0.0\"/></rateGT>\n          </gtrModel>\n".to_string(),
                "      <stateNode idref=\"rateAC\"/>\n      <stateNode idref=\"rateAG\"/>\n      <stateNode idref=\"rateAT\"/>\n      <stateNode idref=\"rateCG\"/>\n      <stateNode idref=\"rateGT\"/>\n      <stateNode idref=\"freqs\"/>\n".to_string(),
                "      <operator id=\"rateACScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"0.5\">\n        <parameter idref=\"rateAC\"/>\n      </operator>\n      <operator id=\"rateAGScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"0.5\">\n        <parameter idref=\"rateAG\"/>\n      </operator>\n      <operator id=\"rateATScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"0.5\">\n        <parameter idref=\"rateAT\"/>\n      </operator>\n      <operator id=\"rateCGScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"0.5\">\n        <parameter idref=\"rateCG\"/>\n      </operator>\n      <operator id=\"rateGTScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"0.5\">\n        <parameter idref=\"rateGT\"/>\n      </operator>\n      <operator id=\"freqsDelta\" spec=\"DeltaExchange\" weight=\"0.5\">\n        <parameter idref=\"freqs\"/>\n      </operator>\n".to_string(),
            ),
            _ => (
                // HKY（JC 视为 kappa 固定为 1 的特例，不进 state）
                "          <hkyModel id=\"substModel\">\n            <frequencies>\n              <frequencyModel spec=\"Frequencies\" dataType=\"nucleotide\">\n                <frequencies><parameter id=\"freqs\" value=\"0.25 0.25 0.25 0.25\"/></frequencies>\n              </frequencyModel>\n            </frequencies>\n            <kappa><parameter id=\"kappa\" value=\"2.0\" lower=\"0.0\"/></kappa>\n          </hkyModel>\n".to_string(),
                "      <stateNode idref=\"kappa\"/>\n      <stateNode idref=\"freqs\"/>\n".to_string(),
                "      <operator id=\"kappaScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"1\">\n        <parameter idref=\"kappa\"/>\n      </operator>\n      <operator id=\"freqsDelta\" spec=\"DeltaExchange\" weight=\"0.5\">\n        <parameter idref=\"freqs\"/>\n      </operator>\n".to_string(),
            ),
        }
    };

    // ---------- 位点模型：Gamma 类别 + 不变位点 ----------
    let gamma_block = if gamma_cats > 0 {
        state_nodes.push_str("      <stateNode idref=\"gammaShape\"/>\n");
        operators.push_str("      <operator id=\"gammaShapeScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"1\">\n        <parameter idref=\"gammaShape\"/>\n      </operator>\n");
        format!("    <gammaShape gammaCategories=\"{}\"><parameter id=\"gammaShape\" value=\"0.5\" lower=\"0.0\"/></gammaShape>\n", gamma_cats)
    } else {
        String::new()
    };
    let pinv_block = if pinv >= 0.0 {
        format!("    <proportionInvariant><parameter id=\"pinv\" value=\"{:.4}\" lower=\"0.0\" upper=\"1.0\"/></proportionInvariant>\n", pinv)
    } else {
        String::new()
    };

    // ---------- 分子钟：Strict / Relaxed LogNormal / Relaxed Exponential ----------
    let clock_init = (1.0 / gen_time.max(1e-6)).max(1e-6);
    let (clock_block, clock_ref) = match clock {
        "relaxed_ln" | "relaxed_exp" => {
            let dist = if clock == "relaxed_ln" {
                "      <logNormalDistributionModel meanInRealSpace=\"false\">\n        <mean><parameter idref=\"ucld.mean\"/></mean>\n        <stdev><parameter idref=\"ucld.stdev\"/></stdev>\n      </logNormalDistributionModel>\n"
            } else {
                "      <exponentialDistributionModel>\n        <mean><parameter idref=\"ucld.mean\"/></mean>\n      </exponentialDistributionModel>\n"
            };
            state_nodes.push_str("      <stateNode idref=\"ucld.mean\"/>\n      <stateNode idref=\"ucld.stdev\"/>\n");
            operators.push_str("      <operator id=\"ucldMeanScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"3\">\n        <parameter idref=\"ucld.mean\"/>\n      </operator>\n      <operator id=\"ucldStdevScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"3\">\n        <parameter idref=\"ucld.stdev\"/>\n      </operator>\n");
            (
                format!(
                    "  <relaxedClockModel id=\"relaxedClock\">\n    <rate>\n      <parameter id=\"ucld.mean\" value=\"{clock_init}\" lower=\"0.0\"/>\n    </rate>\n    <variance>\n      <parameter id=\"ucld.stdev\" value=\"0.333\" lower=\"0.0\" upper=\"Infinity\"/>\n    </variance>\n    <treeModel idref=\"treeModel\"/>\n    <distributionModel>\n{dist}    </distributionModel>\n  </relaxedClockModel>\n",
                    clock_init = clock_init,
                    dist = dist,
                ),
                "    <relaxedClockModel idref=\"relaxedClock\"/>\n",
            )
        }
        _ => {
            state_nodes.push_str("      <stateNode idref=\"clockRate\"/>\n");
            operators.push_str("      <operator id=\"clockRateScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"3\">\n        <parameter idref=\"clockRate\"/>\n      </operator>\n");
            (
                format!(
                    "  <strictClockModel id=\"clockModel\">\n    <rate><parameter id=\"clockRate\" value=\"{clock_init}\" lower=\"0.0\"/></rate>\n  </strictClockModel>\n",
                    clock_init = clock_init
                ),
                "    <strictClockModel idref=\"clockModel\"/>\n",
            )
        }
    };

    // ---------- 树先验：Skyline / Coalescent 常量 / 指数增长 / Yule / Birth-Death ----------
    let (prior_block, prior_likelihood, prior_logger) = match tree_prior {
        "constant" => {
            state_nodes.push_str("      <stateNode idref=\"popSize\"/>\n");
            operators.push_str("      <operator id=\"popSizeScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"3\">\n        <parameter idref=\"popSize\"/>\n      </operator>\n");
            (
                "  <constantSize id=\"constantPop\" units=\"substitutions\">\n    <populationSize><parameter id=\"popSize\" value=\"1.0\" lower=\"0.0\" upper=\"Infinity\"/></populationSize>\n  </constantSize>\n".to_string(),
                "  <coalescentLikelihood id=\"coalescent\">\n    <model idref=\"constantPop\"/>\n    <tree idref=\"treeModel\"/>\n  </coalescentLikelihood>\n".to_string(),
                "      <log idref=\"popSize\"/>\n",
            )
        }
        "exponential" => {
            state_nodes.push_str("      <stateNode idref=\"expGrowth.size\"/>\n      <stateNode idref=\"expGrowth.rate\"/>\n");
            operators.push_str("      <operator id=\"expSizeScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"3\">\n        <parameter idref=\"expGrowth.size\"/>\n      </operator>\n      <operator id=\"expRateRandomWalk\" spec=\"RandomWalkOperator\" windowSize=\"1.0\" weight=\"3\">\n        <parameter idref=\"expGrowth.rate\"/>\n      </operator>\n");
            (
                "  <exponentialGrowth id=\"expGrowth\" units=\"substitutions\">\n    <populationSize><parameter id=\"expGrowth.size\" value=\"1.0\" lower=\"0.0\" upper=\"Infinity\"/></populationSize>\n    <growthRate><parameter id=\"expGrowth.rate\" value=\"0.0\" lower=\"-Infinity\" upper=\"Infinity\"/></growthRate>\n  </exponentialGrowth>\n".to_string(),
                "  <coalescentLikelihood id=\"coalescent\">\n    <model idref=\"expGrowth\"/>\n    <tree idref=\"treeModel\"/>\n  </coalescentLikelihood>\n".to_string(),
                "      <log idref=\"expGrowth.size\"/>\n      <log idref=\"expGrowth.rate\"/>\n",
            )
        }
        "yule" => {
            state_nodes.push_str("      <stateNode idref=\"yule.birthRate\"/>\n");
            operators.push_str("      <operator id=\"yuleScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"3\">\n        <parameter idref=\"yule.birthRate\"/>\n      </operator>\n");
            (
                "  <yuleModel id=\"yule\" units=\"substitutions\">\n    <birthRate><parameter id=\"yule.birthRate\" value=\"1.0\" lower=\"0.0\" upper=\"Infinity\"/></birthRate>\n  </yuleModel>\n".to_string(),
                "  <speciationLikelihood id=\"speciation\">\n    <model idref=\"yule\"/>\n    <tree idref=\"treeModel\"/>\n  </speciationLikelihood>\n".to_string(),
                "      <log idref=\"yule.birthRate\"/>\n",
            )
        }
        "bd" => {
            state_nodes.push_str("      <stateNode idref=\"bd.birthDeath\"/>\n");
            operators.push_str("      <operator id=\"bdScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"3\">\n        <parameter idref=\"bd.birthDeath\"/>\n      </operator>\n");
            (
                "  <birthDeathModel id=\"birthDeath\" units=\"substitutions\">\n    <birthRate><parameter id=\"bd.birthRate\" value=\"1.0\" lower=\"0.0\"/></birthRate>\n    <relativeDeathRate><parameter id=\"bd.deathRate\" value=\"0.5\" lower=\"0.0\" upper=\"1.0\"/></relativeDeathRate>\n  </birthDeathModel>\n".to_string(),
                "  <speciationLikelihood id=\"speciation\">\n    <model idref=\"birthDeath\"/>\n    <tree idref=\"treeModel\"/>\n  </speciationLikelihood>\n".to_string(),
                "      <log idref=\"bd.birthRate\"/>\n      <log idref=\"bd.deathRate\"/>\n",
            )
        }
        _ => {
            // Bayesian Skyline（默认）：分组参数进 state
            state_nodes.push_str("      <stateNode idref=\"skylinePopSizes\"/>\n      <stateNode idref=\"skylineGroupSizes\"/>\n");
            operators.push_str("      <operator id=\"skylinePopSizesScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"1\">\n        <parameter idref=\"skylinePopSizes\"/>\n      </operator>\n      <operator id=\"skylineGroupSizesScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"1\">\n        <parameter idref=\"skylineGroupSizes\"/>\n      </operator>\n");
            let pop_init = vec!["1.0"; g].join(" ");
            let grp_init = vec!["1"; g].join(" ");
            (
                format!(
                    "  <bayesianSkylineModel id=\"bayesianSkyline\">\n    <popSizes><parameter id=\"skylinePopSizes\" value=\"{pop_init}\"/></popSizes>\n    <groupSizes><parameter id=\"skylineGroupSizes\" value=\"{grp_init}\"/></groupSizes>\n    <type value=\"linear\"/>\n  </bayesianSkylineModel>\n",
                    pop_init = pop_init,
                    grp_init = grp_init,
                ),
                "  <coalescentLikelihood id=\"coalescent\">\n    <model idref=\"bayesianSkyline\"/>\n    <tree idref=\"treeModel\"/>\n  </coalescentLikelihood>\n".to_string(),
                "      <log idref=\"bayesianSkyline\"/>\n",
            )
        }
    };

    let seq_xml: String = seqs
        .iter()
        .map(|(n, s)| format!("    <sequence taxon=\"{}\">{}</sequence>\n", escape_attr(n), s))
        .collect();
    let log_every = ((chain as f64) / 2000.0).max(1.0) as i64;
    let log_path_str = log_path.to_string_lossy().replace('\\', "/");

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<beast version="1.10.0"
       namespace="beast.core:beast.evolution.alignment:beast.evolution.tree.coalescent:beast.core.util:beast.evolution.operators:beast.evolution.likelihood:beast.evolution.tree:beast.evolution.datatype:beast.evolution.substitutionmodel:beast.evolution.siteModel">
  <data id="alignment" name="alignment" dataType="{datatype}">
{seq_xml}  </data>

  <siteModel id="siteModel">
{gamma_block}{pinv_block}    <substitutionModel>
{subst_inner}    </substitutionModel>
  </siteModel>

{clock_block}
  <treeModel id="treeModel">
    <coalescentTree id="startingTree">
      <taxa idref="alignment"/>
    </coalescentTree>
    <rootHeightTrait name="rootHeight"/>
  </treeModel>

{prior_block}
{prior_likelihood}
  <treeLikelihood id="treeLikelihood">
    <data idref="alignment"/>
    <tree idref="treeModel"/>
    <siteModel idref="siteModel"/>
{clock_ref}  </treeLikelihood>

  <mcmc id="mcmc" chainLength="{chain}">
    <state>
{state_nodes}      <stateNode idref="treeModel"/>
    </state>
    <operatorSchedule>
{operators}      <operator id="treeScaler" spec="TreeScaler" scaleFactor="0.5" weight="1">
        <tree idref="treeModel"/>
      </operator>
      <operator id="treeRootScaler" spec="TreeRootScaler" scaleFactor="0.5" weight="1">
        <tree idref="treeModel"/>
      </operator>
      <operator id="uniform" spec="Uniform" weight="10">
        <tree idref="treeModel"/>
      </operator>
      <operator id="subtreeSlide" spec="SubtreeSlide" weight="5" gaussian="true">
        <tree idref="treeModel"/>
      </operator>
      <operator id="narrow" spec="Exchange" weight="1">
        <tree idref="treeModel"/>
      </operator>
      <operator id="wide" spec="Exchange" weight="1" isNarrow="false">
        <tree idref="treeModel"/>
      </operator>
      <operator id="wilsonBalding" spec="WilsonBalding" weight="1">
        <tree idref="treeModel"/>
      </operator>
    </operatorSchedule>
    <logger logEvery="{log_every}">
      <log idref="treeLikelihood"/>
      <log idref="treeModel.rootHeight"/>
{prior_logger}    </logger>
    <logger fileName="{log_path_str}" logEvery="{log_every}">
{prior_logger}      <log idref="treeModel.rootHeight"/>
    </logger>
  </mcmc>
</beast>
"#,
        datatype = datatype,
        seq_xml = seq_xml,
        gamma_block = gamma_block,
        pinv_block = pinv_block,
        subst_inner = subst_inner,
        clock_block = clock_block,
        prior_block = prior_block,
        prior_likelihood = prior_likelihood,
        clock_ref = clock_ref,
        chain = chain,
        state_nodes = state_nodes,
        operators = operators,
        log_every = log_every,
        prior_logger = prior_logger,
        log_path_str = log_path_str,
    )
}

/// 解析 BEAST1 `.log`，提取天际线有效种群规模曲线（skyline.N 列）。
/// 返回 (归一化时间轴, Ne 数组)，时间轴与内置近似同口径（0=现在→1=过去）。
fn parse_skyline_log(path: &Path, _groups: i64) -> Option<(Vec<f64>, Vec<f64>)> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut lines = content
        .lines()
        .filter(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with('#')
        });
    let header = lines.find(|l| l.starts_with("Sample"))?;
    let cols: Vec<&str> = header.split('\t').collect();
    let mut idx: Vec<usize> = Vec::new();
    for (i, c) in cols.iter().enumerate() {
        let s = c.trim();
        let is_numbered =
            s.len() > 8 && s.starts_with("skyline.") && s[8..].chars().all(|ch| ch.is_ascii_digit());
        let is_pi = s.ends_with("Pi") || s.contains(".Pi");
        if is_numbered || is_pi {
            idx.push(i);
        }
    }
    if idx.len() < 2 {
        return None;
    }
    let g = idx.len();
    let mut rows: Vec<Vec<f64>> = Vec::new();
    for l in lines {
        let parts: Vec<&str> = l.split('\t').collect();
        if parts.len() < cols.len() {
            continue;
        }
        let mut row = Vec::with_capacity(idx.len());
        let mut ok = true;
        for &i in &idx {
            match parts[i].trim().parse::<f64>() {
                Ok(v) => row.push(v),
                Err(_) => {
                    ok = false;
                    break;
                }
            }
        }
        if ok && row.len() == idx.len() {
            rows.push(row);
        }
    }
    if rows.is_empty() {
        return None;
    }
    let burn = rows.len() / 10;
    let rows = &rows[burn..];
    if rows.is_empty() {
        return None;
    }
    let mut ne_avg = vec![0.0f64; g];
    for r in rows {
        for (k, v) in r.iter().enumerate() {
            ne_avg[k] += v;
        }
    }
    for v in ne_avg.iter_mut() {
        *v /= rows.len() as f64;
    }
    let gg = g.max(2);
    let mut times = Vec::with_capacity(gg * 2);
    let mut ne = Vec::with_capacity(gg * 2);
    for i in 0..gg {
        times.push(i as f64 / gg as f64);
        times.push((i as f64 + 1.0) / gg as f64);
        let v = ne_avg[i];
        ne.push(v);
        ne.push(v);
    }
    Some((times, ne))
}

/// 解析 BEAST1 `.log`，提取 TMRCA（treeModel.rootHeight 均值，去燃尽）。
fn parse_root_height(path: &Path) -> Option<f64> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut lines = content
        .lines()
        .filter(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with('#')
        });
    let header = lines.find(|l| l.starts_with("Sample"))?;
    let cols: Vec<&str> = header.split('\t').collect();
    let mut ci: Option<usize> = None;
    for (i, c) in cols.iter().enumerate() {
        let s = c.trim();
        if s == "treeModel.rootHeight" || s.ends_with("rootHeight") {
            ci = Some(i);
            break;
        }
    }
    let ci = ci?;
    let mut vals: Vec<f64> = Vec::new();
    for l in lines {
        let parts: Vec<&str> = l.split('\t').collect();
        if parts.len() <= ci {
            continue;
        }
        if let Ok(v) = parts[ci].trim().parse::<f64>() {
            vals.push(v);
        }
    }
    if vals.is_empty() {
        return None;
    }
    let burn = vals.len() / 10;
    let vals = &vals[burn..];
    if vals.is_empty() {
        return None;
    }
    let sum: f64 = vals.iter().sum();
    Some(sum / vals.len() as f64)
}

/// BEAST1 运行的公共部分：生成 XML → 运行 → 返回 log 路径。
/// 失败返回 Err（前端回退内置近似）。
fn run_beast_xml(
    fasta: &str,
    params: &BeastRunParams,
    tag: &str,
) -> Result<(PathBuf, String), String> {
    let seqs = parse_fasta(fasta);
    if seqs.len() < 2 {
        return Err("序列不足，无法进行贝叶斯推断".into());
    }
    let aa = is_aa(&seqs);
    let dir = std::env::temp_dir();
    let cfg = dir.join(format!("evosuite_beast_{}.xml", tag));
    let log_path = dir.join(format!("evosuite_beast_{}.log", tag));
    let xml = generate_beast_xml(
        &seqs,
        aa,
        &params.tree_prior,
        &params.clock,
        &params.subst,
        params.gamma_cats,
        params.pinv,
        params.groups,
        params.chain,
        params.gen_time,
        &log_path,
    );
    if std::fs::write(&cfg, xml).is_err() {
        return Err("写入 BEAST 配置失败".into());
    }
    let ok = match beast_command(&params.engine, &cfg).output() {
        Ok(o) => o.status.success() && log_path.exists(),
        Err(_) => false,
    };
    if !ok {
        let _ = std::fs::remove_file(&cfg);
        let _ = std::fs::remove_file(&log_path);
        return Err("BEAST 未安装或运行失败，请在内核管理中安装后重试".into());
    }
    Ok((log_path, cfg.to_string_lossy().to_string()))
}

/// BEAST1/2 运行参数（v0.1.1：BEAUti 分类：树先验/位点模型/分子钟/MCMC）。
#[derive(serde::Deserialize, Default)]
#[serde(default)]
pub struct BeastRunParams {
    #[serde(rename = "treePrior")]
    pub tree_prior: String, // "skyline" | "constant" | "exponential" | "yule" | "bd"
    pub clock: String,      // "strict" | "relaxed_ln" | "relaxed_exp"
    pub subst: String,      // "hky" | "gtr" | "jc"
    #[serde(rename = "gammaCats")]
    pub gamma_cats: i64,    // 0 = off
    pub pinv: f64,          // <0 = off
    pub groups: i64,
    pub chain: i64,
    #[serde(rename = "genTime")]
    pub gen_time: f64,
    pub engine: String,     // "beast1" | "beast2"
}

impl BeastRunParams {
    fn norm(&mut self) {
        if !matches!(
            self.tree_prior.as_str(),
            "skyline" | "constant" | "exponential" | "yule" | "bd"
        ) {
            self.tree_prior = if self.tree_prior == "bayesian" { "skyline".into() } else { "skyline".into() };
        }
        if !matches!(self.clock.as_str(), "strict" | "relaxed_ln" | "relaxed_exp") {
            self.clock = "strict".into();
        }
        if !matches!(self.subst.as_str(), "hky" | "gtr" | "jc") {
            self.subst = "hky".into();
        }
        if self.chain <= 0 {
            self.chain = 10_000_000;
        }
        if self.groups <= 0 {
            self.groups = 5;
        }
        if self.gen_time <= 0.0 {
            self.gen_time = 1.0;
        }
        if self.gamma_cats < 0 {
            self.gamma_cats = 0;
        }
    }
}

/// 调用外部 BEAST1 进行贝叶斯天际线(Bayesian Skyline)推断。
/// v0.1.1：params 承载 BEAUti 分类参数（树先验/位点模型/分子钟/MCMC）。
#[tauri::command]
pub fn run_beast(
    fasta: String,
    model: String,
    groups: i64,
    chain: i64,
    engine: String,
    params: Option<BeastRunParams>,
) -> Result<BeastResult, String> {
    let mut p = params.unwrap_or_default();
    // 兼容旧签名：显式 groups/chain 覆盖默认值
    if groups > 0 {
        p.groups = groups;
    }
    if chain > 0 {
        p.chain = chain;
    }
    p.engine = engine;
    // 旧调用把树先验模型放在 model（constant/exponential/skyline）：
    // 仅当 params 未显式给出 tree_prior 时才用 model 兜底，避免覆盖 yule/bd。
    if p.tree_prior.is_empty() && matches!(model.as_str(), "constant" | "exponential" | "skyline") {
        p.tree_prior = model.clone();
    }
    p.norm();
    let (log_path, cfg) = run_beast_xml(&fasta, &p, "sky")?;
    let g = p.groups.max(2);
    match parse_skyline_log(&log_path, g) {
        Some((times, ne)) => {
            let _ = std::fs::remove_file(&cfg);
            let _ = std::fs::remove_file(&log_path);
            Ok(BeastResult {
                model: p.tree_prior.clone(),
                groups: g,
                times,
                ne,
                from_engine: true,
            })
        }
        None => {
            let _ = std::fs::remove_file(&cfg);
            let _ = std::fs::remove_file(&log_path);
            Err("BEAST 已运行但未解析到天际线结果，回退到内置近似".into())
        }
    }
}

/// 调用外部 BEAST1 进行系统动态(phylodynamics)推断。
/// 复用贝叶斯 MCMC，解析 TMRCA 与 Ne 曲线，派生增长率 / R0 / 合并率。
/// 注：Tauri v2 自动做 snake_case ↔ camelCase 参数转换（gen_time ↔ genTime）。
#[tauri::command]
pub fn run_beast_phylodynamics(
    fasta: String,
    model: String,
    groups: i64,
    gen_time: f64,
    engine: String,
    params: Option<BeastRunParams>,
) -> Result<BeastPhylodynamicsResult, String> {
    let seqs = parse_fasta(&fasta);
    let mut p = params.unwrap_or_default();
    if groups > 0 {
        p.groups = groups;
    }
    p.gen_time = gen_time.max(0.1);
    p.chain = 10_000_000; // 系统动态默认链长（保持既有行为）
    p.engine = engine;
    if p.tree_prior.is_empty() && matches!(model.as_str(), "constant" | "exponential" | "skyline") {
        p.tree_prior = model.clone();
    }
    p.norm();
    if seqs.len() < 2 {
        return Err("序列不足，无法进行系统动态推断".into());
    }
    let (log_path, cfg) = run_beast_xml(&fasta, &p, "phylo")?;
    let g = p.groups.max(2);
    let pd = avg_pdist(&seqs);
    let tmrca = parse_root_height(&log_path).unwrap_or_else(|| (pd * seqs.len() as f64).max(0.01));
    let (_, ne) = parse_skyline_log(&log_path, g).unwrap_or_default();
    let ne0 = ne.last().copied().unwrap_or(seqs.len() as f64 * 1.5);
    let first = ne.first().copied().unwrap_or(ne0);
    let growth_rate = if first > 0.0 { (ne0 / first).ln() } else { 0.0 };
    let rate = if tmrca > 0.0 { pd / tmrca } else { 0.01 };
    let r0 = (growth_rate * gen_time.max(0.1)).exp().max(1.0);
    let gg = g.max(2) as usize;
    let mut times = Vec::with_capacity(gg * 2);
    let mut coalescent_rate = Vec::with_capacity(gg * 2);
    for i in 0..gg {
        times.push(i as f64 / gg as f64);
        times.push((i as f64 + 1.0) / gg as f64);
        let v = ne.get(i).copied().unwrap_or(ne0).max(0.5);
        coalescent_rate.push(1.0 / v);
        coalescent_rate.push(1.0 / v);
    }
    let _ = std::fs::remove_file(&cfg);
    let _ = std::fs::remove_file(&log_path);
    Ok(BeastPhylodynamicsResult {
        tmrca,
        growth_rate,
        rate,
        r0,
        ne0,
        times,
        coalescent_rate,
        from_engine: true,
    })
}
