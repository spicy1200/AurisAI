use super::recorder::{capture_stream, resample_linear, CAPTURE_RATE, TARGET_RATE};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use tokio::sync::mpsc::Sender;
use wasapi::Direction;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LiveChannel {
    Interviewer,
    SelfMic,
}

impl LiveChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            LiveChannel::Interviewer => "interviewer",
            LiveChannel::SelfMic => "self",
        }
    }

    pub fn wire_byte(self) -> u8 {
        match self {
            LiveChannel::Interviewer => 0,
            LiveChannel::SelfMic => 1,
        }
    }
}

pub struct PcmFrame {
    pub channel: LiveChannel,
    pub pcm: Vec<u8>,
}

pub struct LiveCapture {
    stop: Arc<AtomicBool>,
    handles: Vec<JoinHandle<()>>,
}

#[derive(Default)]
struct StreamResampler {
    leftover: Vec<f32>,
}

impl StreamResampler {
    fn push(&mut self, mono48k: &[f32]) -> Vec<u8> {
        self.leftover.extend_from_slice(mono48k);
        // 100ms @ 48 kHz
        const IN_BLOCK: usize = 4800;
        let mut pcm = Vec::new();
        while self.leftover.len() >= IN_BLOCK {
            let block: Vec<f32> = self.leftover.drain(..IN_BLOCK).collect();
            let resampled = resample_linear(&block, CAPTURE_RATE, TARGET_RATE);
            for s in resampled {
                let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                pcm.extend_from_slice(&v.to_le_bytes());
            }
        }
        pcm
    }
}

impl LiveCapture {
    pub fn start(
        tx: Sender<PcmFrame>,
        mic_device_id: Option<String>,
        system_device_id: Option<String>,
        mic_enabled: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let mut handles = Vec::new();

        {
            let stop_c = Arc::clone(&stop);
            let tx_c = tx.clone();
            handles.push(thread::spawn(move || {
                let mut rs = StreamResampler::default();
                if let Err(e) = capture_stream(Direction::Render, system_device_id, stop_c, |mono| {
                    let pcm = rs.push(mono);
                    if !pcm.is_empty() {
                        let _ = tx_c.blocking_send(PcmFrame {
                            channel: LiveChannel::Interviewer,
                            pcm,
                        });
                    }
                }) {
                    eprintln!("[AurisAI] live loopback capture error: {e}");
                }
            }));
        }

        {
            let stop_c = Arc::clone(&stop);
            let mic_on = Arc::clone(&mic_enabled);
            handles.push(thread::spawn(move || {
                let mut rs = StreamResampler::default();
                if let Err(e) = capture_stream(Direction::Capture, mic_device_id, stop_c, |mono| {
                    if !mic_on.load(Ordering::Relaxed) {
                        let _ = rs.push(mono);
                        return;
                    }
                    let pcm = rs.push(mono);
                    if !pcm.is_empty() {
                        let _ = tx.blocking_send(PcmFrame {
                            channel: LiveChannel::SelfMic,
                            pcm,
                        });
                    }
                }) {
                    eprintln!("[AurisAI] live mic capture error: {e}");
                }
            }));
        }

        Ok(Self { stop, handles })
    }

    pub fn stop(self) {
        self.stop.store(true, Ordering::SeqCst);
        for h in self.handles {
            let _ = h.join();
        }
    }
}
