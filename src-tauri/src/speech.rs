use reqwest::Url;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechAudio {
    mime: String,
    bytes: Vec<u8>,
}

fn public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.is_documentation()
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)))
        }
        IpAddr::V6(ip) => {
            ip.to_ipv4_mapped()
                .map_or(true, |mapped| public_address(IpAddr::V4(mapped)))
                && !(ip.is_loopback()
                    || ip.is_unique_local()
                    || ip.is_unicast_link_local()
                    || ip.is_unspecified()
                    || ip.is_multicast())
        }
    }
}

fn render_template(template: &str, text: &str) -> Result<Url, String> {
    const SINGLE: &str = "{{speakText}}";
    const DOUBLE: &str = "{{java.encodeURI(java.encodeURI(speakText))}}";
    if text.is_empty() || text.chars().count() > 240 {
        return Err("朗读片段需在 1–240 字之间".into());
    }
    if template.len() > 2048 || (!template.contains(SINGLE) && !template.contains(DOUBLE)) {
        return Err("引擎地址须包含 {{speakText}} 占位符".into());
    }
    let encoded = urlencoding::encode(text);
    let rendered = template
        .replace(DOUBLE, &urlencoding::encode(&encoded))
        .replace(SINGLE, &encoded);
    if rendered.contains("{{") || rendered.contains("}}") {
        return Err("引擎包含暂不支持的 Legado 表达式".into());
    }
    let url = Url::parse(&rendered).map_err(|_| "引擎地址无效".to_string())?;
    if url.scheme() != "https" || url.username() != "" || url.password().is_some() {
        return Err("在线朗读仅支持不含账号密码的 HTTPS 地址".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn fetch_speech_audio(template: String, text: String) -> Result<SpeechAudio, String> {
    let url = render_template(&template, &text)?;
    let host = url.host_str().ok_or("引擎地址缺少域名")?;
    let port = url.port_or_known_default().ok_or("引擎端口无效")?;
    let addresses: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|_| "无法解析朗读服务域名".to_string())?
        .collect();
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|address| !public_address(address.ip()))
    {
        return Err("已阻止朗读服务访问本机或内网地址".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .resolve(host, addresses[0])
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("朗读服务请求失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("朗读服务返回 HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > 2_000_000)
    {
        return Err("朗读音频超过 2 MB".into());
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        mime.as_str(),
        "audio/mpeg"
            | "audio/mp3"
            | "audio/wav"
            | "audio/x-wav"
            | "audio/ogg"
            | "audio/mp4"
            | "audio/aac"
    ) {
        return Err("朗读服务未返回受支持的音频格式".into());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > 2_000_000 || bytes.is_empty() {
        return Err("朗读音频为空或超过 2 MB".into());
    }
    Ok(SpeechAudio {
        mime,
        bytes: bytes.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::render_template;

    #[test]
    fn renders_only_supported_legado_placeholders() {
        assert_eq!(
            render_template("https://example.com/?text={{speakText}}", "你好，世界")
                .unwrap()
                .query()
                .unwrap(),
            "text=%E4%BD%A0%E5%A5%BD%EF%BC%8C%E4%B8%96%E7%95%8C"
        );
        assert!(
            render_template("https://example.com/?text={{java.foo(speakText)}}", "你好").is_err()
        );
        assert!(render_template("http://example.com/?text={{speakText}}", "你好").is_err());
    }
}
