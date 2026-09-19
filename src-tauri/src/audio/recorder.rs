use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use wasapi::{
    get_default_device, initialize_mta, DeviceCollection, Direction, SampleType, StreamMode,
    WaveFormat,
};

pub(crate) const TARGET_RATE: u32 = 16_000;
pub(crate) const CAPTURE_RATE: u32 = 48_000;
const CAPTURE_CHANNELS: usize = 2;

pub(crate) fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
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

/// Capture from mic (`Direction::Capture`) or system loopback (`Direction::Render`).
/// Empty / `None` `device_id` uses the system default for that direction.
pub(crate) fn capture_stream(
    device_dir: Direction,
    device_id: Option<String>,
    stop: Arc<AtomicBool>,
    mut on_mono: impl FnMut(&[f32]),
) -> Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|e| format!("COM MTA init failed: {e:?}"))?;

    let device = match device_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(id) => {
            let collection = DeviceCollection::new(&device_dir)
                .map_err(|e| format!("获取设备列表失败: {e}"))?;
            let n = collection
                .get_nbr_devices()
                .map_err(|e| format!("读取设备数量失败: {e}"))?;
            let mut found = None;
            for i in 0..n {
                let Ok(dev) = collection.get_device_at_index(i) else {
                    continue;
                };
                if dev.get_id().ok().as_deref() == Some(id) {
                    found = Some(dev);
                    break;
                }
            }
            found.ok_or_else(|| "未找到所选音频设备，请重选或改用系统默认".to_string())?
        }
        None => get_default_device(&device_dir)
            .map_err(|e| format!("获取默认音频设备失败 ({device_dir:?}): {e}"))?,
    };
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
            let mono = float_bytes_to_mono(&chunk, CAPTURE_CHANNELS);
            on_mono(&mono);
        }
        let _ = h_event.wait_for_event(50);
    }
    let _ = audio_client.stop_stream();
    Ok(())
}
