//! One-shot private protocol. No config loader, decoder process, device, or downloader.
use aurum_core::{
    AudioInput, AurumEngine, CancelFlag, Config, OperationOptions, SttResultDto, SynthesisRequest,
    TranscriptionRequest,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, Read, Write},
    os::unix::{fs::OpenOptionsExt, io::FromRawFd},
    path::{Component, Path, PathBuf},
    time::Duration,
};

const MAX_REQUEST: usize = 32 * 1024;
const MAX_RESPONSE: usize = 1024 * 1024;
const MAX_WAV: u64 = 20 * 1024 * 1024;
const MAX_OUTPUT: usize = 50 * 1024 * 1024;
type Result<T> = std::result::Result<T, &'static str>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    protocol_version: u32,
    request_id: String,
    operation: Operation,
    cache_root: PathBuf,
    payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Operation {
    Transcribe,
    Synthesize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Transcribe {
    input_path: PathBuf,
    model_path: PathBuf,
    language: Option<String>,
}

// The three Kitten files are passed one by one: the plugin's content-addressed
// cache keeps each file in its own directory.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Synthesize {
    text: String,
    output_path: PathBuf,
    model_path: PathBuf,
    voices_path: PathBuf,
    config_path: PathBuf,
    voice: Option<String>,
}

fn payload<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| "INVALID_REQUEST")
}

fn core_error(e: aurum_core::AurumError) -> &'static str {
    use aurum_core::ErrorCategory::*;
    match e.error_category() {
        Cancelled => "CANCELLED",
        DeadlineExceeded => "DEADLINE_EXCEEDED",
        ModelUnavailable => "MODEL_MISSING",
        ArtifactIntegrity => "INTEGRITY_MISMATCH",
        InvalidInput | User => "INVALID_REQUEST",
        UnsupportedCapability => "UNSUPPORTED_CAPABILITY",
        Filesystem | DiskFull => "FILESYSTEM_ERROR",
        _ => "INFERENCE_FAILED",
    }
}

// The parent supplies admitted, private staging paths. Reject symlinks in every
// existing component too; this is defense in depth, not host authorization.
fn checked_path(path: &Path, may_be_missing: bool) -> Result<()> {
    if !path.is_absolute() || path.as_os_str().len() > 4096 {
        return Err("INVALID_PATH");
    }
    let mut current = PathBuf::new();
    for part in path.components() {
        if !matches!(part, Component::RootDir | Component::Normal(_)) {
            return Err("INVALID_PATH");
        }
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(m) if m.file_type().is_symlink() => return Err("INVALID_PATH"),
            Ok(_) => (),
            Err(e) if may_be_missing && e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("PATH_MISSING"),
        }
    }
    Ok(())
}

fn private_dir(path: &Path) -> Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    checked_path(path, true)?;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|_| "FILESYSTEM_ERROR")?;
    checked_path(path, false)
}

fn open_read(path: &Path) -> Result<File> {
    checked_path(path, false)?;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "FILESYSTEM_ERROR")?;
    if !file.metadata().map_err(|_| "FILESYSTEM_ERROR")?.is_file() {
        return Err("INVALID_PATH");
    }
    Ok(file)
}

fn hash_file(path: &Path, size: u64) -> Result<String> {
    let mut f = open_read(path)?;
    if f.metadata().map_err(|_| "FILESYSTEM_ERROR")?.len() != size {
        return Err("INTEGRITY_MISMATCH");
    }
    let mut hash = Sha256::new();
    let mut block = [0u8; 65536];
    loop {
        let n = f.read(&mut block).map_err(|_| "FILESYSTEM_ERROR")?;
        if n == 0 {
            break;
        }
        hash.update(&block[..n]);
    }
    Ok(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

// Copy only reviewed bytes, never symlink package assets into writable cache.
fn stage(source: &Path, target: &Path, hash: &str, size: u64) -> Result<()> {
    if hash_file(source, size)? != hash {
        return Err("INTEGRITY_MISMATCH");
    }
    if target.exists() {
        return if hash_file(target, size)? == hash {
            Ok(())
        } else {
            Err("INTEGRITY_MISMATCH")
        };
    }
    private_dir(target.parent().ok_or("INVALID_PATH")?)?;
    let mut input = open_read(source)?;
    let mut out = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(target)
        .map_err(|_| "FILESYSTEM_ERROR")?;
    let copied = std::io::copy(&mut (&mut input).take(size + 1), &mut out)
        .map_err(|_| "FILESYSTEM_ERROR")?;
    out.sync_all().map_err(|_| "FILESYSTEM_ERROR")?;
    if copied != size || hash_file(target, size)? != hash {
        let _ = fs::remove_file(target);
        return Err("INTEGRITY_MISMATCH");
    }
    Ok(())
}

fn config(cache: PathBuf) -> Config {
    Config {
        provider: "local".into(),
        model: Some("tiny-q5_1".into()),
        language: "auto".into(),
        output: "json".into(),
        output_file: None,
        timestamps: true,
        verbose: false,
        openrouter_api_key: None,
        openrouter_base_url: aurum_core::config::DEFAULT_OPENROUTER_BASE_URL.into(),
        openrouter_default_model: aurum_core::config::DEFAULT_OPENROUTER_MODEL.into(),
        openrouter_allow_custom_endpoint: false,
        openrouter_stt_mode: "auto".into(),
        openrouter_use_system_proxy: false,
        providers: Default::default(),
        cleanup_style: "raw".into(),
        cleanup_provider: "rules".into(),
        cleanup_openrouter_model: None,
        tts_provider: "local".into(),
        tts_model: "kitten-nano-int8".into(),
        tts_voice: "Luna".into(),
        tts_language: "en".into(),
        tts_speaking_rate: 1.0,
        tts_max_chars: 5000,
        tts_timeout_ms: 115_000,
        tts_pack_dir: None,
        tts_allow_unverified: false,
        tts_custom_models: vec![],
        local_only: true,
        config_path: None,
        cache_dir: cache,
    }
}

fn text_bound(text: &str) -> Result<()> {
    if text.trim().is_empty() || text.chars().count() > 5000 || text.contains('\0') {
        Err("INVALID_REQUEST")
    } else {
        Ok(())
    }
}

// Strict RIFF/WAVE PCM16 parser: no ffmpeg path, extensible/compressed/float WAV,
// duplicate chunks, partial frames, inconsistent rates or trailing bytes.
fn wav(path: &Path) -> Result<Vec<f32>> {
    let f = open_read(path)?;
    let size = f.metadata().map_err(|_| "FILESYSTEM_ERROR")?.len();
    if !(44..=MAX_WAV).contains(&size) {
        return Err("INVALID_AUDIO");
    }
    let mut bytes = Vec::with_capacity(size as usize);
    f.take(MAX_WAV + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "FILESYSTEM_ERROR")?;
    decode_wav(&bytes)
}

fn decode_wav(b: &[u8]) -> Result<Vec<f32>> {
    fn u16le(b: &[u8], p: usize) -> u16 {
        u16::from_le_bytes([b[p], b[p + 1]])
    }
    fn u32le(b: &[u8], p: usize) -> u32 {
        u32::from_le_bytes([b[p], b[p + 1], b[p + 2], b[p + 3]])
    }
    if b.len() < 44
        || b.len() > MAX_WAV as usize
        || &b[..4] != b"RIFF"
        || &b[8..12] != b"WAVE"
        || u32le(b, 4) as usize + 8 != b.len()
    {
        return Err("INVALID_AUDIO");
    }
    let (mut fmt, mut data) = (None, None);
    let mut p = 12usize;
    while p + 8 <= b.len() {
        let len = u32le(b, p + 4) as usize;
        let end = (p + 8).checked_add(len).ok_or("INVALID_AUDIO")?;
        if end > b.len() {
            return Err("INVALID_AUDIO");
        }
        match &b[p..p + 4] {
            b"fmt " => {
                if fmt.is_some() || len != 16 {
                    return Err("INVALID_AUDIO");
                }
                let q = p + 8;
                let channels = u16le(b, q + 2) as usize;
                let rate = u32le(b, q + 4) as usize;
                if u16le(b, q) != 1
                    || !matches!(channels, 1 | 2)
                    || !(8000..=48000).contains(&rate)
                    || u16le(b, q + 14) != 16
                    || u16le(b, q + 12) as usize != channels * 2
                    || u32le(b, q + 8) as usize != rate * channels * 2
                {
                    return Err("INVALID_AUDIO");
                }
                fmt = Some((channels, rate));
            }
            b"data" => {
                if data.is_some() {
                    return Err("INVALID_AUDIO");
                }
                data = Some(&b[p + 8..end]);
            }
            _ => (),
        }
        p = end + len % 2;
    }
    if p != b.len() {
        return Err("INVALID_AUDIO");
    }
    let (channels, rate) = fmt.ok_or("INVALID_AUDIO")?;
    let data = data.ok_or("INVALID_AUDIO")?;
    let frames = data.len() / (channels * 2);
    if frames == 0 || data.len() % (channels * 2) != 0 || frames > rate * 600 {
        return Err("INVALID_AUDIO");
    }
    let mono: Vec<f32> = data
        .chunks_exact(channels * 2)
        .map(|f| {
            f.chunks_exact(2)
                .map(|v| i16::from_le_bytes([v[0], v[1]]) as f32 / 32768.0)
                .sum::<f32>()
                / channels as f32
        })
        .collect();
    if rate == 16000 {
        return Ok(mono);
    }
    // Bounded in-process linear resampling. This compact adapter prioritizes
    // deterministic admission; it is not a studio-quality sample-rate converter.
    let count = frames * 16000 / rate;
    Ok((0..count)
        .map(|i| {
            let x = i as f64 * rate as f64 / 16000.0;
            let n = x as usize;
            let f = (x - n as f64) as f32;
            mono[n] * (1.0 - f) + mono[(n + 1).min(frames - 1)] * f
        })
        .collect())
}

async fn dispatch(req: Request, control: OperationOptions) -> Result<Value> {
    checked_path(&req.cache_root, true)?;
    let ctx = control.clone().into_op_context();
    ctx.check().map_err(core_error)?;
    match req.operation {
        Operation::Transcribe => {
            let p: Transcribe = payload(req.payload)?;
            let language = p.language.unwrap_or_else(|| "auto".into());
            if language.is_empty()
                || language.len() > 16
                || !language
                    .bytes()
                    .all(|v| v.is_ascii_alphabetic() || v == b'-')
            {
                return Err("INVALID_REQUEST");
            }
            let samples = wav(&p.input_path)?;
            let info = aurum_core::model::lookup_model("tiny-q5_1").map_err(core_error)?;
            stage(
                &p.model_path,
                &aurum_core::model::model_path(&req.cache_root, info),
                aurum_core::model::pinned_sha256(info.filename).ok_or("MODEL_MISSING")?,
                32_152_673,
            )?;
            ctx.check().map_err(core_error)?;
            let engine = AurumEngine::from_config(config(req.cache_root)).map_err(core_error)?;
            let audio = AudioInput::from_pcm(samples, 16000).map_err(core_error)?;
            let result = engine
                .transcribe_request(
                    &audio,
                    TranscriptionRequest::new("tiny-q5_1")
                        .language(language)
                        .timestamps(true)
                        .operation(control),
                )
                .await
                .map_err(core_error);
            engine.shutdown();
            let dto = SttResultDto::from_result(&result?);
            ctx.check().map_err(core_error)?;
            serde_json::to_value(dto).map_err(|_| "INTERNAL_ERROR")
        }
        Operation::Synthesize => {
            let p: Synthesize = payload(req.payload)?;
            text_bound(&p.text)?;
            checked_path(&p.output_path, true)?;
            if p.output_path.exists() {
                return Err("OUTPUT_EXISTS");
            }
            let voice = p.voice.unwrap_or_else(|| "Luna".into());
            if !aurum_core::tts::catalogue::VOICES
                .iter()
                .any(|v| v.model == "kitten-nano-int8" && v.id == voice)
            {
                return Err("INVALID_REQUEST");
            }
            let info = &aurum_core::tts::catalogue::MODELS[0];
            let target = aurum_core::tts::catalogue::model_pack_dir(&req.cache_root, info);
            for (source, file) in [
                (&p.model_path, info.onnx),
                (&p.voices_path, info.voices),
                (&p.config_path, info.config),
            ] {
                stage(
                    source,
                    &target.join(file.filename),
                    file.sha256,
                    file.approx_bytes,
                )?;
            }
            ctx.check().map_err(core_error)?;
            let engine = AurumEngine::from_config(config(req.cache_root)).map_err(core_error)?;
            let result = engine
                .synthesize_request(
                    &p.text,
                    SynthesisRequest::new("kitten-nano-int8", voice).operation(control),
                )
                .await
                .map_err(core_error);
            engine.shutdown();
            let result = result?;
            ctx.check().map_err(core_error)?;
            if result.pcm_i16_mono.len() * 2 + 44 > MAX_OUTPUT {
                return Err("OUTPUT_LIMIT");
            }
            checked_path(&p.output_path, true)?;
            // Private output uses create_new: no overwrite, symlink following or
            // core CLI output-path inference. Parent owns deletion/publication.
            let mut out = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&p.output_path)
                .map_err(|_| "FILESYSTEM_ERROR")?;
            let bytes = (result.pcm_i16_mono.len() * 2) as u32;
            let mut header = Vec::with_capacity(44);
            header.extend(b"RIFF");
            header.extend((bytes + 36).to_le_bytes());
            header.extend(b"WAVEfmt ");
            header.extend(16u32.to_le_bytes());
            header.extend(1u16.to_le_bytes());
            header.extend(1u16.to_le_bytes());
            header.extend(result.sample_rate_hz.to_le_bytes());
            header.extend((result.sample_rate_hz * 2).to_le_bytes());
            header.extend(2u16.to_le_bytes());
            header.extend(16u16.to_le_bytes());
            header.extend(b"data");
            header.extend(bytes.to_le_bytes());
            out.write_all(&header).map_err(|_| "FILESYSTEM_ERROR")?;
            let mut writer = std::io::BufWriter::new(out);
            for s in &result.pcm_i16_mono {
                writer
                    .write_all(&s.to_le_bytes())
                    .map_err(|_| "FILESYSTEM_ERROR")?;
            }
            writer.flush().map_err(|_| "FILESYSTEM_ERROR")?;
            ctx.check().map_err(core_error)?;
            // Metadata does not include PCM.
            Ok(
                json!({"meta":aurum_core::dto::TtsMetaDto::from_result(&result),"outputPath":p.output_path}),
            )
        }
    }
}

fn request() -> Result<Request> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .lock()
        .take((MAX_REQUEST + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| "INVALID_REQUEST")?;
    if bytes.len() > MAX_REQUEST || bytes.last() != Some(&b'\n') {
        return Err("REQUEST_LIMIT");
    }
    let req: Request = serde_json::from_slice(&bytes).map_err(|_| "INVALID_REQUEST")?;
    if req.protocol_version != 1
        || req.request_id.is_empty()
        || req.request_id.len() > 128
        || !req
            .request_id
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || matches!(v, b'-' | b'_' | b'.' | b':'))
    {
        return Err("INVALID_REQUEST");
    }
    Ok(req)
}

// Native libraries may print paths or text. Route their stdout/stderr to null,
// retaining a dedicated response FD. No tracing subscriber is installed.
fn response_channel() -> std::io::Result<File> {
    unsafe {
        let fd = libc::dup(libc::STDOUT_FILENO);
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        let null = File::options().write(true).open("/dev/null")?;
        use std::os::fd::AsRawFd;
        if libc::dup2(null.as_raw_fd(), 1) < 0 || libc::dup2(null.as_raw_fd(), 2) < 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(File::from_raw_fd(fd))
    }
}

#[tokio::main]
async fn main() {
    let Ok(mut output) = response_channel() else {
        std::process::exit(1);
    };
    std::panic::set_hook(Box::new(|_| {}));
    let cancel = CancelFlag::new();
    let signal_cancel = cancel.clone();
    tokio::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};
        if let (Ok(mut term), Ok(mut interrupt)) = (
            signal(SignalKind::terminate()),
            signal(SignalKind::interrupt()),
        ) {
            tokio::select! { _ = term.recv() => (), _ = interrupt.recv() => () }
            signal_cancel.cancel();
        }
    });
    let control = OperationOptions::new()
        .with_cancel(cancel)
        .with_timeout_from_now(Duration::from_secs(115));
    let (id, result) = match request() {
        Ok(req) => (req.request_id.clone(), dispatch(req, control).await),
        Err(code) => (String::new(), Err(code)),
    };
    let response = match result {
        Ok(result) => json!({"protocolVersion":1,"requestId":id,"ok":true,"result":result}),
        Err(code) => json!({"protocolVersion":1,"requestId":id,"ok":false,"error":{"code":code}}),
    };
    let mut bytes = serde_json::to_vec(&response).unwrap_or_default();
    if bytes.len() + 1 > MAX_RESPONSE {
        bytes = serde_json::to_vec(
            &json!({"protocolVersion":1,"requestId":id,"ok":false,"error":{"code":"OUTPUT_LIMIT"}}),
        )
        .unwrap();
    }
    bytes.push(b'\n');
    let _ = output.write_all(&bytes);
}
