use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::ipc::Channel;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PrInfo {
    id: String,
    url: String,
    owner: String,
    repo: String,
    #[serde(alias = "pull_number")]
    pull_number: u32,
    #[serde(alias = "base_ref")]
    base_ref: String,
    #[serde(alias = "last_opened_at")]
    last_opened_at: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    body: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    step: String,
    percent: u8,
}

fn parse_pr_url(url: &str) -> Result<(String, String, u32), String> {
    let re = regex::Regex::new(r"github\.com/([^/]+)/([^/]+)/pull/(\d+)")
        .map_err(|e| format!("Regex error: {}", e))?;
    let caps = re
        .captures(url)
        .ok_or_else(|| format!("Invalid PR URL: {}", url))?;
    let owner = caps[1].to_string();
    let repo = caps[2].to_string();
    let pr_number: u32 = caps[3]
        .parse()
        .map_err(|_| "Invalid PR number".to_string())?;
    Ok((owner, repo, pr_number))
}

fn cache_dir() -> Result<PathBuf, String> {
    let base = dirs::cache_dir().ok_or("Could not determine cache directory")?;
    Ok(base.join("komit"))
}

fn data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Could not determine data directory")?;
    Ok(base.join("komit"))
}

fn run_git(args: Vec<String>) -> Result<String, String> {
    let output = Command::new("git")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("`git {}` failed: {}", args.join(" "), stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_cmd(cmd: &str, args: Vec<String>) -> Result<String, String> {
    let output = Command::new(cmd)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run `{}`: {}", cmd, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("`{} {}` failed: {}", cmd, args.join(" "), stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn git(args: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_git(args))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}


fn send_progress(on_progress: &Channel<ProgressPayload>, step: &str, percent: u8) {
    let _ = on_progress.send(ProgressPayload {
        step: step.to_string(),
        percent,
    });
}

struct PrMetadata {
    base_branch: String,
    title: Option<String>,
    body: Option<String>,
}

fn fetch_pr_metadata_sync(
    repo_path_str: &str,
    owner: &str,
    repo: &str,
    pr_number: u32,
) -> Result<PrMetadata, String> {
    let gh_result = run_cmd(
        "gh",
        vec![
            "pr".into(),
            "view".into(),
            pr_number.to_string(),
            "--repo".into(),
            format!("{}/{}", owner, repo),
            "--json".into(),
            "baseRefName,title,body".into(),
        ],
    );

    if let Ok(json_str) = gh_result {
        #[derive(Deserialize)]
        struct GhPrView {
            #[serde(rename = "baseRefName")]
            base_ref_name: Option<String>,
            title: Option<String>,
            body: Option<String>,
        }

        if let Ok(parsed) = serde_json::from_str::<GhPrView>(&json_str) {
            if let Some(base) = parsed.base_ref_name.filter(|s| !s.is_empty()) {
                return Ok(PrMetadata {
                    base_branch: base,
                    title: parsed.title,
                    body: parsed.body,
                });
            }
        }
    }

    let sym_output = run_git(vec![
        "-C".into(),
        repo_path_str.into(),
        "symbolic-ref".into(),
        "HEAD".into(),
    ])?;

    let trimmed = sym_output.trim();
    let branch = trimmed
        .strip_prefix("refs/heads/")
        .ok_or_else(|| format!("Unexpected symbolic-ref output: {}", trimmed))?;

    Ok(PrMetadata {
        base_branch: branch.to_string(),
        title: None,
        body: None,
    })
}

fn diff_cache_path(owner: &str, repo: &str, pr_number: u32) -> Result<PathBuf, String> {
    let dir = data_dir()?.join("diffs").join(owner).join(repo);
    Ok(dir.join(format!("{}.patch", pr_number)))
}

fn save_diff_to_cache(owner: &str, repo: &str, pr_number: u32, diff: &str) -> Result<(), String> {
    let path = diff_cache_path(owner, repo, pr_number)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create diff cache dir: {}", e))?;
    }
    fs::write(&path, diff).map_err(|e| format!("Failed to write diff cache: {}", e))?;
    Ok(())
}

fn save_to_history(pr_info: &PrInfo) -> Result<(), String> {
    let data_dir = data_dir()?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;

    let history_path = data_dir.join("history.json");

    let mut history: Vec<PrInfo> = if history_path.exists() {
        let content = fs::read_to_string(&history_path)
            .map_err(|e| format!("Failed to read history: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    history.retain(|p| p.id != pr_info.id);
    history.push(pr_info.clone());

    let json = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;
    fs::write(&history_path, json)
        .map_err(|e| format!("Failed to write history: {}", e))?;

    Ok(())
}

fn remove_from_history(owner: &str, repo: &str, pr_number: u32) -> Result<(), String> {
    let id = format!("{}/{}#{}", owner, repo, pr_number);
    let data_dir = data_dir()?;
    let history_path = data_dir.join("history.json");

    if history_path.exists() {
        let content = fs::read_to_string(&history_path)
            .map_err(|e| format!("Failed to read history: {}", e))?;
        let mut history: Vec<PrInfo> =
            serde_json::from_str(&content).unwrap_or_default();
        history.retain(|p| p.id != id);
        let json = serde_json::to_string_pretty(&history)
            .map_err(|e| format!("Failed to serialize history: {}", e))?;
        fs::write(&history_path, json)
            .map_err(|e| format!("Failed to write history: {}", e))?;
    }

    if let Ok(path) = diff_cache_path(owner, repo, pr_number) {
        let _ = fs::remove_file(path);
    }

    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FetchPrResult {
    diff: String,
    title: Option<String>,
    body: Option<String>,
}

#[tauri::command]
async fn fetch_pr_diff(
    pr_url: String,
    on_progress: Channel<ProgressPayload>,
) -> Result<FetchPrResult, String> {
    let (owner, repo, pr_number) = parse_pr_url(&pr_url)?;

    send_progress(&on_progress, "Parsing PR URL…", 5);

    let cache = cache_dir()?;
    fs::create_dir_all(&cache)
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;

    let repo_path = cache.join(format!("{}/{}.git", owner, repo));
    let repo_path_str = repo_path
        .to_str()
        .ok_or("Invalid repo path")?
        .to_string();

    if repo_path.exists() {
        send_progress(&on_progress, "Fetching latest from origin…", 15);
        git(vec![
            "-C".into(),
            repo_path_str.clone(),
            "fetch".into(),
            "origin".into(),
        ])
        .await?;
    } else {
        send_progress(
            &on_progress,
            &format!("Cloning {}/{}…", owner, repo),
            15,
        );
        if let Some(parent) = repo_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        git(vec![
            "clone".into(),
            "--bare".into(),
            "--filter=blob:none".into(),
            format!("git@github.com:{}/{}.git", owner, repo),
            repo_path_str.clone(),
        ])
        .await?;
    }

    send_progress(
        &on_progress,
        &format!("Fetching PR #{}…", pr_number),
        45,
    );
    git(vec![
        "-C".into(),
        repo_path_str.clone(),
        "fetch".into(),
        "origin".into(),
        format!("+refs/pull/{}/head:refs/heads/pr-{}", pr_number, pr_number),
    ])
    .await?;

    send_progress(&on_progress, "Fetching PR metadata…", 65);
    let rps = repo_path_str.clone();
    let o = owner.clone();
    let r = repo.clone();
    let metadata = tauri::async_runtime::spawn_blocking(move || {
        fetch_pr_metadata_sync(&rps, &o, &r, pr_number)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    send_progress(&on_progress, "Generating diff…", 80);
    let diff = git(vec![
        "-C".into(),
        repo_path_str.clone(),
        "diff".into(),
        format!("{}...pr-{}", metadata.base_branch, pr_number),
    ])
    .await?;

    let o2 = owner.clone();
    let r2 = repo.clone();
    let diff_clone = diff.clone();
    let now = chrono::Utc::now().to_rfc3339();
    let pr_info = PrInfo {
        id: format!("{}/{}#{}", owner, repo, pr_number),
        url: pr_url,
        owner,
        repo,
        pull_number: pr_number,
        base_ref: metadata.base_branch,
        last_opened_at: now,
        title: metadata.title,
        body: metadata.body,
    };
    let pr_info_clone = pr_info.clone();
    tauri::async_runtime::spawn_blocking(move || {
        save_diff_to_cache(&o2, &r2, pr_number, &diff_clone)?;
        save_to_history(&pr_info_clone)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    Ok(FetchPrResult {
        diff,
        title: pr_info.title,
        body: pr_info.body,
    })
}

#[tauri::command]
async fn load_cached_diff(
    owner: String,
    repo: String,
    pull_number: u32,
) -> Result<String, String> {
    let o = owner;
    let r = repo;
    tauri::async_runtime::spawn_blocking(move || {
        let path = diff_cache_path(&o, &r, pull_number)?;
        if !path.exists() {
            return Err("No cached diff found".to_string());
        }
        fs::read_to_string(&path).map_err(|e| format!("Failed to read cached diff: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
async fn delete_pr(owner: String, repo: String, pull_number: u32) -> Result<(), String> {
    let o = owner;
    let r = repo;
    tauri::async_runtime::spawn_blocking(move || remove_from_history(&o, &r, pull_number))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
fn get_recent_prs() -> Result<Vec<PrInfo>, String> {
    let data_dir = data_dir()?;
    let history_path = data_dir.join("history.json");

    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&history_path)
        .map_err(|e| format!("Failed to read history: {}", e))?;
    let history: Vec<PrInfo> =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse history: {}", e))?;

    Ok(history)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            fetch_pr_diff,
            load_cached_diff,
            delete_pr,
            get_recent_prs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
