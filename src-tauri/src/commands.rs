// 外部引擎接入命令：MAFFT（比对）、IQ-TREE2（最大似然建树）。
// 若系统未安装对应二进制，命令返回 Err，前端自动回退到内置轻量算法。
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
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

/// 调用外部 MAFFT 进行多序列比对，返回 FASTA 文本。
#[tauri::command]
pub fn align_mafft(sequences: Vec<SeqInput>) -> Result<String, String> {
    if sequences.is_empty() {
        return Err("空序列".into());
    }
    let tmp = std::env::temp_dir().join("evosuite_mafft_in.fa");
    let out = std::env::temp_dir().join("evosuite_mafft_out.fa");
    write_fasta(&sequences, &tmp).map_err(|e| format!("写临时文件失败：{e}"))?;

    let status = Command::new("mafft")
        .arg("--auto")
        .arg(&tmp)
        .output();

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
        Err(_) => Err("未检测到 MAFFT，请在桌面端安装后重试".into()),
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
    let status = Command::new("iqtree2")
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
        Err(_) => Err("未检测到 IQ-TREE2，请安装后重试".into()),
    }
}

/// 检测已安装的内核引擎（MAFFT / IQ-TREE2 / RAxML-NG / MrBayes）。
/// 返回每个引擎的状态、版本与发现路径。
#[derive(serde::Serialize)]
pub struct EngineInfo {
    pub status: String,   // "installed" | "missing"
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
        // 尝试用 which/where 解析完整路径；失败则用命令名（说明在 PATH 中）
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
    ];
    let mut map = HashMap::new();
    for (id, bin, flag) in targets {
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

/// 触发内核下载：返回官方下载页 URL（由前端 webview 打开）。
/// 真实安装（下载二进制到软件引擎目录）可在后续版本通过 shell 插件扩展。
#[tauri::command]
pub fn download_engine(id: String) -> Result<EngineUrl, String> {
    let url = match id.as_str() {
        "mafft" => "https://mafft.cbrc.jp/alignment/software/",
        "iqtree2" => "http://www.iqtree.org/",
        "raxmlng" => "https://github.com/amkozlov/raxml-ng",
        "mrbayes" => "https://nbisweden.github.io/MrBayes/",
        "beast1" => "https://beast.community/",
        _ => return Err(format!("未知内核：{id}")),
    };
    Ok(EngineUrl { url: url.to_string() })
}

#[derive(serde::Serialize)]
pub struct EngineUrl {
    pub url: String,
}

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

// ---------- BEAST1 接入辅助 ----------

fn beast_bin(engine: &str) -> &'static str {
    match engine {
        "beast2" => "beast", // BEAST2 也以 `beast` 命令启动（v2.7+ 兼容）
        _ => "beast",
    }
}

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 解析 FASTA 文本为 (名称, 序列) 列表（已大写、去空白）。
fn parse_fasta(text: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
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

/// 生成 BEAST1 贝叶斯天际线（Bayesian Skyline）XML 配置。
/// groups 控制天际线分组数；chain 为 MCMC 链长；gen_time 用于时钟初值标定。
fn generate_beast_xml(
    seqs: &[(String, String)],
    aa: bool,
    groups: i64,
    chain: i64,
    gen_time: f64,
    log_path: &Path,
) -> String {
    let g = groups.max(2) as usize;
    let datatype = if aa { "aminoacid" } else { "nucleotide" };
    let (subst_inner, kappa_state, kappa_op) = if aa {
        (
            "          <jttModel id=\"substModel\"/>\n".to_string(),
            String::new(),
            String::new(),
        )
    } else {
        (
            "          <hkyModel id=\"substModel\">\n            <frequencies>\n              <frequencyModel spec=\"Frequencies\" dataType=\"nucleotide\">\n                <frequencies><parameter id=\"freqs\" value=\"0.25 0.25 0.25 0.25\"/></frequencies>\n              </frequencyModel>\n            </frequencies>\n            <kappa><parameter id=\"kappa\" value=\"2.0\" lower=\"0.0\"/></kappa>\n          </hkyModel>\n".to_string(),
            "      <stateNode idref=\"kappa\"/>\n".to_string(),
            "      <operator id=\"kappaScaler\" spec=\"ScaleOperator\" scaleFactor=\"0.5\" weight=\"1\">\n        <parameter idref=\"kappa\"/>\n      </operator>\n".to_string(),
        )
    };
    let seq_xml: String = seqs
        .iter()
        .map(|(n, s)| format!("    <sequence taxon=\"{}\">{}</sequence>\n", escape_attr(n), s))
        .collect();
    let pop_init = vec!["1.0"; g].join(" ");
    let grp_init = vec!["1"; g].join(" ");
    let log_every = ((chain as f64) / 2000.0).max(1.0) as i64;
    let clock_init = (1.0 / gen_time.max(1e-6)).max(1e-6);
    let log_path_str = log_path.to_string_lossy().replace('\\', "/");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<beast version="1.10.0"
       namespace="beast.core:beast.evolution.alignment:beast.evolution.tree.coalescent:beast.core.util:beast.evolution.operators:beast.evolution.likelihood:beast.evolution.tree:beast.evolution.datatype:beast.evolution.substitutionmodel:beast.evolution.siteModel:beast.evolution.branchratemodel">
  <data id="alignment" name="alignment" dataType="{datatype}">
{seq_xml}  </data>

  <siteModel id="siteModel">
    <gammaShape><parameter id="gammaShape" value="0.5" lower="0.0"/></gammaShape>
    <proportionInvariant><parameter id="pinv" value="0.0" lower="0.0" upper="1.0"/></proportionInvariant>
    <substitutionModel>
{subst_inner}    </substitutionModel>
  </siteModel>

  <strictClockModel id="clockModel">
    <rate><parameter id="clockRate" value="{clock_init}" lower="0.0"/></rate>
  </strictClockModel>

  <treeModel id="treeModel">
    <coalescentTree id="startingTree">
      <taxa idref="alignment"/>
    </coalescentTree>
    <rootHeightTrait name="rootHeight"/>
  </treeModel>

  <bayesianSkylineModel id="bayesianSkyline">
    <popSizes><parameter id="skylinePopSizes" value="{pop_init}"/></popSizes>
    <groupSizes><parameter id="skylineGroupSizes" value="{grp_init}"/></groupSizes>
    <type value="linear"/>
  </bayesianSkylineModel>

  <coalescentLikelihood id="coalescent">
    <model idref="bayesianSkyline"/>
    <tree idref="treeModel"/>
  </coalescentLikelihood>

  <treeLikelihood id="treeLikelihood">
    <data idref="alignment"/>
    <tree idref="treeModel"/>
    <siteModel idref="siteModel"/>
  </treeLikelihood>

  <mcmc id="mcmc" chainLength="{chain}">
    <state>
      <stateNode idref="skylinePopSizes"/>
      <stateNode idref="skylineGroupSizes"/>
{kappa_state}      <stateNode idref="gammaShape"/>
      <stateNode idref="clockRate"/>
      <stateNode idref="treeModel"/>
    </state>
    <operatorSchedule>
{kappa_op}      <operator id="gammaShapeScaler" spec="ScaleOperator" scaleFactor="0.5" weight="1">
        <parameter idref="gammaShape"/>
      </operator>
      <operator id="clockRateScaler" spec="ScaleOperator" scaleFactor="0.5" weight="1">
        <parameter idref="clockRate"/>
      </operator>
      <operator id="skylinePopSizesScaler" spec="ScaleOperator" scaleFactor="0.5" weight="1">
        <parameter idref="skylinePopSizes"/>
      </operator>
      <operator id="skylineGroupSizesScaler" spec="ScaleOperator" scaleFactor="0.5" weight="1">
        <parameter idref="skylineGroupSizes"/>
      </operator>
      <operator id="treeScaler" spec="TreeScaler" scaleFactor="0.5" weight="1">
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
      <log idref="coalescent"/>
      <log idref="bayesianSkyline"/>
      <log idref="clockRate"/>
      <log idref="treeModel.rootHeight"/>
    </logger>
    <logger fileName="{log_path_str}" logEvery="{log_every}">
      <log idref="bayesianSkyline"/>
      <log idref="treeModel.rootHeight"/>
    </logger>
  </mcmc>
</beast>
"#,
        datatype = datatype,
        seq_xml = seq_xml,
        subst_inner = subst_inner,
        clock_init = clock_init,
        pop_init = pop_init,
        grp_init = grp_init,
        chain = chain,
        kappa_state = kappa_state,
        kappa_op = kappa_op,
        log_every = log_every,
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
    // 定位天际线有效种群规模列：skyline.N 或 *.Pi
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

/// 调用外部 BEAST1 进行贝叶斯天际线(Bayesian Skyline)推断。
/// 生成 BEAST1 XML → 调用 beast → 解析 .log 天际线，返回真实曲线（fromEngine=true）。
/// 未安装 beast 或解析失败时返回 Err，由前端回退到内置近似曲线。
#[tauri::command]
pub fn run_beast(
    fasta: String,
    model: String,
    groups: i64,
    chain: i64,
    engine: String,
) -> Result<BeastResult, String> {
    let seqs = parse_fasta(&fasta);
    if seqs.len() < 2 {
        return Err("序列不足，无法进行贝叶斯推断".into());
    }
    let aa = is_aa(&seqs);
    let g = groups.max(2);
    let dir = std::env::temp_dir();
    let cfg = dir.join("evosuite_beast.xml");
    let log_path = dir.join("evosuite_beast.log");
    let xml = generate_beast_xml(&seqs, aa, g, chain, 1.0, &log_path);
    if std::fs::write(&cfg, xml).is_err() {
        return Err("写入 BEAST 配置失败".into());
    }
    let bin = beast_bin(&engine);
    let ok = match Command::new(bin).arg(&cfg).output() {
        Ok(o) => o.status.success() && log_path.exists(),
        Err(_) => false,
    };
    if !ok {
        let _ = std::fs::remove_file(&cfg);
        let _ = std::fs::remove_file(&log_path);
        return Err(format!(
            "未检测到 {} 或 BEAST 运行失败，请通过内核管理安装后重试",
            bin
        ));
    }
    match parse_skyline_log(&log_path, g) {
        Some((times, ne)) => {
            let _ = std::fs::remove_file(&cfg);
            let _ = std::fs::remove_file(&log_path);
            Ok(BeastResult {
                model,
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
/// 复用贝叶斯天际线 MCMC，解析 TMRCA 与 Ne 曲线，派生增长率 / R0 / 合并率。
/// 未安装 beast 或解析失败时返回 Err，由前端回退到内置近似。
/// 注：Tauri v2 自动做 snake_case ↔ camelCase 参数转换（gen_time ↔ genTime），
///     参数级 #[serde(rename)] 不再被 command 宏支持。
#[tauri::command]
pub fn run_beast_phylodynamics(
    fasta: String,
    model: String,
    groups: i64,
    gen_time: f64,
    engine: String,
) -> Result<BeastPhylodynamicsResult, String> {
    let _ = model; // 命令签名兼容（前端传入，此处不参与计算）
    let seqs = parse_fasta(&fasta);
    if seqs.len() < 2 {
        return Err("序列不足，无法进行系统动态推断".into());
    }
    let aa = is_aa(&seqs);
    let g = groups.max(2);
    let dir = std::env::temp_dir();
    let cfg = dir.join("evosuite_beast_phylo.xml");
    let log_path = dir.join("evosuite_beast_phylo.log");
    let xml = generate_beast_xml(&seqs, aa, g, 10_000_000, gen_time.max(0.1), &log_path);
    if std::fs::write(&cfg, xml).is_err() {
        return Err("写入 BEAST 配置失败".into());
    }
    let bin = beast_bin(&engine);
    let ok = match Command::new(bin).arg(&cfg).output() {
        Ok(o) => o.status.success() && log_path.exists(),
        Err(_) => false,
    };
    if !ok {
        let _ = std::fs::remove_file(&cfg);
        let _ = std::fs::remove_file(&log_path);
        return Err(format!(
            "未检测到 {} 或 BEAST 运行失败，请通过内核管理安装后重试",
            bin
        ));
    }
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
