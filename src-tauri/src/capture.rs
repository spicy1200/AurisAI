use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::io::Cursor;
use xcap::Monitor;

/// Capture primary monitor as PNG base64 (no data-url prefix).
pub fn capture_primary_png_base64() -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("枚举显示器失败: {e}"))?;
    let monitor = monitors
        .into_iter()
        .next()
        .ok_or_else(|| "未找到显示器".to_string())?;
    let image = monitor
        .capture_image()
        .map_err(|e| format!("截图失败: {e}"))?;
    let mut buf = Cursor::new(Vec::new());
    image
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("编码截图失败: {e}"))?;
    Ok(STANDARD.encode(buf.into_inner()))
}
