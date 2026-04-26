//! File-attachment text extraction (PDF / DOCX / XLSX) and the
//! `build_content` helper that splices the extracted text into a
//! multimodal `ChatMessageContent`. Split out of the parent adapter
//! module so the streaming logic stays uncluttered.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tracing::warn;

use crate::adapters::ChatAttachmentRef;

use super::gateway::{ChatContentPart, ChatImageUrl, ChatMessageContent};

pub(super) fn extract_text_from_file(path: &str, mime: &str, name: &str) -> Option<String> {
    let ext = std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if matches!(
        mime,
        "text/plain"
            | "text/markdown"
            | "text/csv"
            | "text/html"
            | "text/xml"
            | "application/json"
            | "application/xml"
            | "application/javascript"
    ) || matches!(
        ext.as_str(),
        "txt"
            | "md"
            | "csv"
            | "json"
            | "xml"
            | "html"
            | "htm"
            | "js"
            | "ts"
            | "py"
            | "rs"
            | "go"
            | "java"
            | "c"
            | "cpp"
            | "h"
            | "yaml"
            | "yml"
            | "toml"
            | "ini"
            | "cfg"
            | "log"
            | "sh"
            | "bat"
    ) {
        let bytes = std::fs::read(path).ok()?;
        let text = String::from_utf8_lossy(&bytes);
        Some(text.into_owned())
    } else if ext == "docx"
        || mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    {
        extract_docx_text(path)
    } else if ext == "xlsx"
        || mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    {
        extract_xlsx_text(path)
    } else if ext == "pdf" || mime == "application/pdf" {
        extract_pdf_text(path)
    } else {
        None
    }
}

fn decode_hex(s: &str) -> Result<Vec<u8>, ()> {
    if s.len() % 2 != 0 {
        return Err(());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| ()))
        .collect()
}

fn extract_pdf_text(path: &str) -> Option<String> {
    use lopdf::Document;
    let doc = Document::load(path).ok()?;
    let mut pages_text: Vec<String> = Vec::new();
    let page_ids = doc.get_pages();
    let mut page_nums: Vec<u32> = page_ids.keys().copied().collect();
    page_nums.sort();
    for page_num in page_nums {
        let page_id = match page_ids.get(&page_num) {
            Some(&id) => id,
            None => continue,
        };
        let mut text_parts: Vec<String> = Vec::new();
        if let Ok(page_dict) = doc.get_dictionary(page_id) {
            if let Ok(contents_ref) = page_dict.get(b"Contents") {
                let content_ids: Vec<lopdf::ObjectId> = match contents_ref {
                    lopdf::Object::Reference(id) => vec![*id],
                    lopdf::Object::Array(arr) => arr
                        .iter()
                        .filter_map(|o| {
                            if let lopdf::Object::Reference(id) = o {
                                Some(*id)
                            } else {
                                None
                            }
                        })
                        .collect(),
                    _ => vec![],
                };
                for cid in content_ids {
                    if let Ok(obj) = doc.get_object(cid) {
                        if let Ok(stream) = obj.as_stream() {
                            if let Ok(decompressed) = stream.decompressed_content() {
                                let content_str = String::from_utf8_lossy(&decompressed);
                                for token in content_str.split_whitespace() {
                                    if token.starts_with('(') && token.ends_with(')') {
                                        let inner = &token[1..token.len() - 1];
                                        if !inner.is_empty() {
                                            text_parts.push(inner.to_string());
                                        }
                                    } else if token.starts_with('<') && token.ends_with('>') {
                                        let hex_str = &token[1..token.len() - 1];
                                        if let Ok(bytes) = decode_hex(hex_str) {
                                            if let Ok(s) = String::from_utf8(bytes) {
                                                let cleaned: String =
                                                    s.chars().filter(|c| !c.is_control()).collect();
                                                if !cleaned.is_empty() {
                                                    text_parts.push(cleaned);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if !text_parts.is_empty() {
            pages_text.push(text_parts.join(" "));
        }
    }
    if pages_text.is_empty() {
        return None;
    }
    let full = pages_text.join("\n\n");
    let truncated = if full.len() > 50_000 {
        let mut s = full[..50_000].to_string();
        s.push_str("\n\n[... truncated]");
        s
    } else {
        full
    };
    Some(truncated)
}

fn extract_docx_text(path: &str) -> Option<String> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut xml = match archive.by_name("word/document.xml") {
        Ok(f) => f,
        Err(_) => return None,
    };
    let mut content = String::new();
    let _ = xml.read_to_string(&mut content);
    let text = content
        .split('<')
        .filter_map(|part| {
            if part.starts_with('w') && part.contains('>') {
                let end = part.find('>').unwrap_or(0);
                let tag = &part[..end];
                if tag.contains('t') && !tag.contains('/') {
                    let after = &part[end + 1..];
                    let close = after.find('<').unwrap_or(after.len());
                    let text = &after[..close];
                    if !text.is_empty() {
                        return Some(text.to_string());
                    }
                }
            }
            None
        })
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn extract_xlsx_text(path: &str) -> Option<String> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut xml = match archive.by_name("xl/sharedStrings.xml") {
        Ok(f) => f,
        Err(_) => return None,
    };
    let mut content = String::new();
    let _ = xml.read_to_string(&mut content);
    let mut texts: Vec<String> = Vec::new();
    let mut pos = 0;
    while let Some(start) = content[pos..].find("<t") {
        pos += start;
        if let Some(gt) = content[pos..].find('>') {
            pos += gt + 1;
            if let Some(end) = content[pos..].find("</t>") {
                let text = content[pos..pos + end].trim().to_string();
                if !text.is_empty() {
                    texts.push(text);
                }
                pos += end;
            }
        }
    }
    if texts.is_empty() {
        None
    } else {
        Some(texts.join(" | "))
    }
}

/// Turn a (text, attachments) pair into the right `ChatMessageContent`.
/// Exposed at module level so unit tests can exercise it without spinning
/// up a whole adapter.
pub(super) fn build_content(
    text: String,
    attachments: Vec<ChatAttachmentRef>,
    vision: bool,
) -> ChatMessageContent {
    if attachments.is_empty() {
        return ChatMessageContent::Text(text);
    }

    let mut parts: Vec<ChatContentPart> = Vec::with_capacity(attachments.len() + 1);
    let mut text_with_markers = text;

    // Separate into images (become image_url parts) and others (become
    // text markers). The partitioning happens per-item so a failed read
    // falls through to the marker branch even when the mime claims image.
    for a in attachments {
        let is_image = a.mime.starts_with("image/");
        if is_image && vision {
            // sandbox-allow: attachment paths are already validated at
            // stage time (see `attachment_stage_path`) and live under
            // the app's attachments dir. Adapter code runs without an
            // `AppState` handle; a follow-up will thread the authority
            // through the adapter trait and swap to `sandbox::fs::read`.
            match std::fs::read(&a.path) {
                Ok(bytes) => {
                    let data_url = format!("data:{};base64,{}", a.mime, BASE64.encode(&bytes));
                    parts.push(ChatContentPart::ImageUrl {
                        image_url: ChatImageUrl { url: data_url },
                    });
                    continue;
                }
                Err(e) => {
                    warn!(
                        attachment = %a.name,
                        path = %a.path,
                        error = %e,
                        "attachment read failed; degrading to text marker",
                    );
                    // Fall through to marker branch below.
                }
            }
        }
        // Non-image (or failed image read): annotate the text part so the
        // model is at least aware the file existed.
        if !text_with_markers.is_empty() {
            text_with_markers.push_str("\n\n");
        }
        if is_image && !vision {
            text_with_markers.push_str(&format!(
                "[attached: {} (图片 - 当前模型不支持图片)]",
                a.name
            ));
        } else if let Some(extracted) = extract_text_from_file(&a.path, &a.mime, &a.name) {
            let cap = 50000;
            let truncated = if extracted.len() > cap {
                format!("{}...(文件过长，已截断)", &extracted[..cap])
            } else {
                extracted
            };
            text_with_markers.push_str(&format!("[attached: {}]\n{}", a.name, truncated));
        } else {
            text_with_markers.push_str(&format!("[attached: {}]", a.name));
        }
    }

    // The text part goes first — OpenAI docs recommend this ordering so
    // the model reads instructions before attachments.
    let mut out: Vec<ChatContentPart> = vec![ChatContentPart::Text {
        text: text_with_markers,
    }];
    out.append(&mut parts);
    ChatMessageContent::Parts(out)
}
