use std::path::{Path, PathBuf};
use std::process::Command;
use zhconv::{zhconv, Variant};

/// Transcribe via whisper.cpp CLI (whisper-cli.exe / main.exe).
pub fn transcribe_file(
    cli_path: &str,
    model_path: &str,
    wav_path: &Path,
    language: &str,
) -> Result<String, String> {
    if cli_path.trim().is_empty() {
        return Err(
            "请先在设置中指定 Whisper CLI 路径（whisper.cpp 的 whisper-cli.exe）".into(),
        );
    }
    if model_path.trim().is_empty() {
        return Err("请先在设置中指定 Whisper 模型路径（强烈推荐 ggml-small.bin）".into());
    }
    let cli = Path::new(cli_path);
    if !cli.exists() {
        return Err(format!("Whisper CLI 不存在: {cli_path}"));
    }
    if !Path::new(model_path).exists() {
        return Err(format!("Whisper 模型文件不存在: {model_path}"));
    }
    if !wav_path.exists() {
        return Err(format!("录音文件不存在: {}", wav_path.display()));
    }

    // Official sizes: small ≈ 487601967, medium ≈ 1533773056.
    // Incomplete downloads still start with "ggml" magic but fail with
    // "vector too long" / failed to initialize whisper context.
    if let Ok(meta) = std::fs::metadata(model_path) {
        let name = Path::new(model_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let len = meta.len();
        if name.contains("medium") && !name.contains("q5") && !name.contains("q8") {
            if !(1_500_000_000..=1_560_000_000).contains(&len) {
                return Err(format!(
                    "ggml-medium.bin 尚未下载完成或不完整（当前 {len} 字节，完整约 1533773056 / 1.5GB）。\n\
请等下载完成后再试，或暂时改回 ggml-small.bin：\n\
D:\\Software\\phpstudy_pro\\WWW\\AurisAI\\resuorce\\ggml-small.bin\n\
下载地址：https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"
                ));
            }
        } else if name.contains("small")
            && !name.contains("medium")
            && !name.contains("q5")
            && !name.contains("q8")
        {
            if !(480_000_000..=495_000_000).contains(&len) {
                return Err(format!(
                    "ggml-small.bin 文件大小异常（当前 {len} 字节，官方约 487601967）。\n\
多半是下载不完整，请重新下载：\n\
https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin\n\
下载后覆盖：{model_path}"
                ));
            }
        }
    }

    let model_name = Path::new(model_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if model_name.contains("quran") || model_name.contains("-ar-") {
        return Err(
            "当前模型是专用模型（如 ggml-base-ar-quran），不能用于中文会议转写。\n请下载通用模型 ggml-small.bin：\nhttps://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin".into(),
        );
    }

    let using_base = model_name.contains("base") && !model_name.contains("small");

    let lang = if language.trim().is_empty() {
        "zh"
    } else {
        language.trim()
    };
    let prefer_hans = lang.eq_ignore_ascii_case("zh")
        || lang.eq_ignore_ascii_case("chinese")
        || lang.to_ascii_lowercase().starts_with("zh-");

    // Whisper's zh tokenizer/training skews Traditional; seed Simplified via prompt.
    let hans_prompt = "以下是普通话的简体中文会议录音转写。";

    let out_base = wav_path.with_extension("");
    let _ = std::fs::remove_file(format!("{}.txt", out_base.display()));

    let cli_dir = cli.parent().unwrap_or_else(|| Path::new("."));
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(4, 12))
        .unwrap_or(8)
        .to_string();

    // NOTE:
    // - Do NOT use -tp 0 + -nf together — causes token-loop hallucinations.
    // - Force CPU (-ng) and disable flash-attn (-nfa).
    // - -mc 0 clears previous-segment text context (stops phrase loops like 半紙樣…).
    // - --prompt biases zh output toward Simplified Chinese.
    let mut args: Vec<String> = vec![
        "-m".into(),
        model_path.to_string(),
        "-f".into(),
        wav_path.to_string_lossy().into_owned(),
        "-l".into(),
        lang.to_string(),
        "-t".into(),
        threads,
        "-bs".into(),
        "5".into(),
        "-bo".into(),
        "5".into(),
        "-mc".into(),
        "0".into(),
        "-ng".into(),
        "-nfa".into(),
        "-sns".into(),
        "-nt".into(),
        "-np".into(),
        "-of".into(),
        out_base.to_string_lossy().into_owned(),
        "-otxt".into(),
    ];
    if prefer_hans {
        args.push("--prompt".into());
        args.push(hans_prompt.into());
    }

    let output = Command::new(cli)
        .current_dir(cli_dir)
        .args(&args)
        .output()
        .map_err(|e| {
            format!(
                "启动 Whisper CLI 失败: {e}（请确认路径为 whisper-cli.exe，且为 Windows x64 版本）"
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{stderr}\n{stdout}");
        if combined.contains("vector too long")
            || combined.contains("failed to initialize whisper context")
        {
            return Err(format!(
                "Whisper 无法加载模型（code={:?}）。\n\
常见原因：1) 模型还在下载/不完整；2) 选错了损坏的 bin。\n\
请确认设置中的模型路径指向完整文件（small≈466MB，medium≈1.5GB），必要时先改回 ggml-small.bin。\n\
程序已使用 -ng -nfa（CPU）。\n\n\
原始输出：\n{combined}",
                output.status.code()
            ));
        }
        return Err(format!(
            "Whisper CLI 退出失败 code={:?}\n{combined}",
            output.status.code()
        ));
    }

    let raw = if {
        let p = PathBuf::from(format!("{}.txt", out_base.display()));
        p.exists()
    } {
        read_text_file_lossy(&PathBuf::from(format!("{}.txt", out_base.display())))?
    } else {
        decode_bytes_lossy(&output.stdout)
    };

    let mut text = cleanup_transcript(&raw);
    if prefer_hans {
        text = zhconv(&text, Variant::ZhCN);
        text = cleanup_transcript(&text);
    }
    if text.is_empty() {
        return Err(
            "未识别到有效语音内容。请确认会议有声音，并在设置中先关掉「同时录制麦克风」再试。"
                .into(),
        );
    }
    if is_repetition_hallucination(&text) {
        return Err(format!(
            "转写结果像是模型幻觉（大量重复字词）。\n建议：关掉麦克风混录、先试听 wav 是否清晰，再用「AI 校对」。\n录音：{}\n预览：{}",
            wav_path.display(),
            text.chars().take(40).collect::<String>()
        ));
    }

    if using_base {
        eprintln!(
            "[AurisAI] 当前为 ggml-base，中文会议准确率有限，建议改用 ggml-small.bin"
        );
    }

    Ok(text)
}

pub fn model_quality_hint(model_path: &str) -> Option<String> {
    let name = Path::new(model_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.contains("tiny") || (name.contains("base") && !name.contains("small")) {
        Some(
            "当前模型偏小（base/tiny），中文会议容易错字。建议改用 ggml-small.bin 或 ggml-medium.bin，并用「AI 校对」二次修正。"
                .into(),
        )
    } else if name.contains("small") && !name.contains("medium") && !name.contains("large") {
        Some(
            "当前为 small。若仍有同音错字，可换更大的 ggml-medium.bin（约 1.5GB，更准更慢），或对结果用「AI 校对」。"
                .into(),
        )
    } else {
        None
    }
}

fn read_text_file_lossy(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取转写结果失败: {e}"))?;
    Ok(decode_bytes_lossy(&bytes))
}

fn decode_bytes_lossy(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);

    let utf8 = String::from_utf8_lossy(bytes);
    let repl = utf8.matches('\u{FFFD}').count();
    if repl <= 2 {
        return utf8.trim_end_matches('\u{FFFD}').to_string();
    }

    let (gb, _, gb_err) = encoding_rs::GB18030.decode(bytes);
    if !gb_err {
        return gb.into_owned();
    }
    utf8.into_owned()
}

fn is_repetition_hallucination(text: &str) -> bool {
    let chars: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
    if chars.len() < 12 {
        return false;
    }
    let mut run = 1usize;
    let mut max_run = 1usize;
    for i in 1..chars.len() {
        if chars[i] == chars[i - 1] {
            run += 1;
            max_run = max_run.max(run);
        } else {
            run = 1;
        }
    }
    if max_run >= 12 {
        return true;
    }
    // Phrase loops: "半纸样半纸样半纸样"
    for n in 2..=6 {
        if has_ngram_loop(&chars, n, 4) {
            return true;
        }
    }
    let mut uniq = chars.clone();
    uniq.sort_unstable();
    uniq.dedup();
    chars.len() >= 30 && uniq.len() <= 4
}

fn has_ngram_loop(chars: &[char], n: usize, min_repeats: usize) -> bool {
    if chars.len() < n * min_repeats {
        return false;
    }
    let mut i = 0;
    while i + n * min_repeats <= chars.len() {
        let unit = &chars[i..i + n];
        let mut reps = 1;
        let mut j = i + n;
        while j + n <= chars.len() && &chars[j..j + n] == unit {
            reps += 1;
            j += n;
        }
        if reps >= min_repeats {
            return true;
        }
        i += 1;
    }
    false
}

fn collapse_repeated_ngrams(text: &str) -> String {
    let mut chars: Vec<char> = text.chars().collect();
    for n in (2..=6).rev() {
        let mut out = Vec::with_capacity(chars.len());
        let mut i = 0;
        while i < chars.len() {
            if i + n * 2 <= chars.len() {
                let unit = &chars[i..i + n];
                let mut reps = 1;
                let mut j = i + n;
                while j + n <= chars.len() && &chars[j..j + n] == unit {
                    reps += 1;
                    j += n;
                }
                if reps >= 3 {
                    out.extend_from_slice(unit);
                    i = j;
                    continue;
                }
            }
            out.push(chars[i]);
            i += 1;
        }
        chars = out;
    }
    chars.into_iter().collect()
}

fn cleanup_transcript(raw: &str) -> String {
    let mut out = raw.to_string();
    let junk = [
        "(笑)",
        "（笑）",
        "(笑声)",
        "（笑声）",
        "(音乐)",
        "（音乐）",
        "(鼓掌)",
        "（鼓掌）",
        "(静音)",
        "（静音）",
        "(空白)",
        "[BLANK_AUDIO]",
        "[ Silence ]",
        "(silence)",
        "(music)",
        "(laughs)",
        "(laughing)",
        "(applause)",
    ];
    for j in junk {
        out = out.replace(j, "");
    }

    out = out
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    collapse_repeated_ngrams(out.trim())
}
