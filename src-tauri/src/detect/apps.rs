use sysinfo::System;

const TARGETS: &[(&str, &str)] = &[
    ("Weixin.exe", "微信"),
    ("WeChat.exe", "微信"),
    ("WeChatAppEx.exe", "微信"),
    ("wemeetapp.exe", "腾讯会议"),
    ("wemeet.exe", "腾讯会议"),
    ("DingTalk.exe", "钉钉"),
    ("DingTalkLauncher.exe", "钉钉"),
];

pub fn list_meeting_apps() -> Vec<String> {
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut found = Vec::new();
    for (_pid, proc) in sys.processes() {
        let name = proc.name().to_string_lossy();
        for (exe, label) in TARGETS {
            if name.eq_ignore_ascii_case(exe) && !found.iter().any(|x: &String| x == label) {
                found.push((*label).to_string());
            }
        }
    }
    found.sort();
    found
}
