use parking_lot::Mutex;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use thiserror::Error;
use wasapi::{
    get_default_device, initialize_mta, Direction, SampleType, StreamMode, WaveFormat,
};

const TARGET_RATE: u32 = 16_000;
const CAPTURE_RATE: u32 = 48_000;
const CAPTURE_CHANNELS: usize = 2;

#[derive(Error, Debug)]
pub enum RecorderError {
    #[error("{0}")]
    Message(String),
}

pub struct Recorder {
    stop: Arc<AtomicBool>,
    handles: Vec<JoinHandle<()>>,
    loopback_buf: Arc<Mutex<Vec<f32>>>,
    mic_buf: Arc<Mutex<Vec<f32>>>,
    include_mic: bool,
    out_dir: PathBuf,
}

impl Recorder {
    pub fn start(include_mic: bool, out_dir: PathBuf) -> Result<Self, RecorderError> {
        std::fs::create_dir_all(&out_dir)
            .map_err(|e| RecorderError::Message(format!("创建录音目录失败: {e}")))?;

        let stop = Arc::new(AtomicBool::new(false));
        let loopback_buf = Arc::new(Mutex::new(Vec::new()));
        let mic_buf = Arc::new(Mutex::new(Vec::new()));
        let mut handles = Vec::new();

        {
            let stop_c = Arc::clone(&stop);
            let buf = Arc::clone(&loopback_buf);
            handles.push(thread::spawn(move || {
                if let Err(e) = capture_stream(Direction::Render, stop_c, buf) {
                    eprintln!("[AurisAI] loopback capture error: {e}");
                }
            }));
        }

        if include_mic {
            let stop_c = Arc::clone(&stop);
            let buf = Arc::clone(&mic_buf);
            handles.push(thread::spawn(move || {
                if let Err(e) = capture_stream(Direction::Capture, stop_c, buf) {
                    eprintln!("[AurisAI] mic capture error: {e}");
                }
            }));
        }

        thread::sleep(Duration::from_millis(250));

        Ok(Self {
            stop,
            handles,
            loopback_buf,
            mic_buf,
            include_mic,
            out_dir,
        })
    }

    pub fn stop(self) -> Result<PathBuf, RecorderError> {
        self.stop.store(true, Ordering::SeqCst);
        for h in self.handles {
            let _ = h.join();
        }

        let loopback = self.loopback_buf.lock().clone();
        let mic = if self.include_mic {
            self.mic_buf.lock().clone()
        } else {
            Vec::new()
        };

        if loopback.is_empty() && mic.is_empty() {
            return Err(RecorderError::Message(
                "未采集到音频，请检查系统播放设备与麦克风权限".into(),
            ));
        }

        let mixed = mix_buffers(&loopback, &mic);
        let resampled = resample_linear(&mixed, CAPTURE_RATE, TARGET_RATE);

        let stamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let path = self.out_dir.join(format!("rec_{stamp}.wav"));
        write_wav_i16(&path, &resampled, TARGET_RATE)
            .map_err(|e| RecorderError::Message(format!("写入 wav 失败: {e}")))?;
        Ok(path)
    }
}

fn mix_buffers(loopback: &[f32], mic: &[f32]) -> Vec<f32> {
    if loopback.is_empty() {
        return normalize_peak(mic, 0.95);
    }
    if mic.is_empty() {
        return normalize_peak(loopback, 0.95);
    }
    // Mic often re-captures speaker playback → echo/garble in Whisper.
    // Keep loopback primary; blend attenuated mic.
    const MIC_GAIN: f32 = 0.35;
    let len = loopback.len().max(mic.len());
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        let va = loopback.get(i).copied().unwrap_or(0.0);
        let vb = mic.get(i).copied().unwrap_or(0.0) * MIC_GAIN;
        out.push(va + vb);
    }
    normalize_peak(&out, 0.95)
}

fn normalize_peak(samples: &[f32], target: f32) -> Vec<f32> {
    let peak = samples
        .iter()
        .map(|s| s.abs())
        .fold(0.0_f32, f32::max);
    // Avoid amplifying near-silence / hiss into full-scale noise (causes Whisper loops).
    if peak < 0.02 {
        return samples.iter().map(|s| s.clamp(-1.0, 1.0)).collect();
    }
    if peak <= target {
        return samples.iter().map(|s| s.clamp(-1.0, 1.0)).collect();
    }
    let gain = target / peak;
    samples.iter().map(|s| (s * gain).clamp(-1.0, 1.0)).collect()
}

fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    // Cubic Hermite (Catmull-Rom-ish) — better than linear for speech before Whisper.
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    if input.len() < 4 {
        return resample_linear_basic(input, from, to);
    }
    let ratio = to as f64 / from as f64;
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    let last = input.len() - 1;
    for i in 0..out_len {
        let src = i as f64 / ratio;
        let i1 = src.floor() as isize;
        let t = (src - i1 as f64) as f32;
        let p0 = input[i1.saturating_sub(1).clamp(0, last as isize) as usize];
        let p1 = input[i1.clamp(0, last as isize) as usize];
        let p2 = input[(i1 + 1).clamp(0, last as isize) as usize];
        let p3 = input[(i1 + 2).clamp(0, last as isize) as usize];
        // Catmull-Rom
        let t2 = t * t;
        let t3 = t2 * t;
        let sample = 0.5
            * (2.0 * p1
                + (-p0 + p2) * t
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
        out.push(sample.clamp(-1.0, 1.0));
    }
    out
}

fn resample_linear_basic(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    let ratio = to as f64 / from as f64;
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 / ratio;
        let i0 = src.floor() as usize;
        let i1 = (i0 + 1).min(input.len() - 1);
        let t = (src - i0 as f64) as f32;
        out.push(input[i0] * (1.0 - t) + input[i1] * t);
    }
    out
}

fn write_wav_i16(path: &Path, samples: &[f32], sample_rate: u32) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer.write_sample(v).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok(())
}

fn float_bytes_to_mono(bytes: &[u8], channels: usize) -> Vec<f32> {
    let floats: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    if channels <= 1 {
        return floats;
    }
    floats
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

fn push_mono(target: &Arc<Mutex<Vec<f32>>>, bytes: &[u8]) {
    let mono = float_bytes_to_mono(bytes, CAPTURE_CHANNELS);
    target.lock().extend(mono);
}

/// Capture from default mic (`Direction::Capture`) or system loopback (`Direction::Render`).
fn capture_stream(
    device_dir: Direction,
    stop: Arc<AtomicBool>,
    buf: Arc<Mutex<Vec<f32>>>,
) -> Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|e| format!("COM MTA init failed: {e:?}"))?;

    let device = get_default_device(&device_dir)
        .map_err(|e| format!("获取音频设备失败 ({device_dir:?}): {e}"))?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|e| format!("get_iaudioclient: {e}"))?;

    let desired = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        CAPTURE_RATE as usize,
        CAPTURE_CHANNELS,
        None,
    );
    let (_def, min_time) = audio_client
        .get_device_period()
        .map_err(|e| format!("get_device_period: {e}"))?;
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: min_time,
    };

    // Render device + Capture stream direction => WASAPI loopback flag
    audio_client
        .initialize_client(&desired, &Direction::Capture, &mode)
        .map_err(|e| format!("initialize_client: {e}"))?;

    let h_event = audio_client
        .set_get_eventhandle()
        .map_err(|e| format!("set_get_eventhandle: {e}"))?;
    let capture = audio_client
        .get_audiocaptureclient()
        .map_err(|e| format!("get_audiocaptureclient: {e}"))?;
    let blockalign = desired.get_blockalign() as usize;
    let mut queue: VecDeque<u8> = VecDeque::with_capacity(blockalign * 8192);

    audio_client
        .start_stream()
        .map_err(|e| format!("start_stream: {e}"))?;

    while !stop.load(Ordering::SeqCst) {
        let _ = capture.read_from_device_to_deque(&mut queue);
        let frames = queue.len() / blockalign;
        if frames > 0 {
            let nbytes = frames * blockalign;
            let mut chunk = vec![0u8; nbytes];
            for b in chunk.iter_mut() {
                *b = queue.pop_front().unwrap();
            }
            push_mono(&buf, &chunk);
        }
        // Short timeout so we can notice stop flag quickly
        let _ = h_event.wait_for_event(50);
    }
    let _ = audio_client.stop_stream();
    Ok(())
}
