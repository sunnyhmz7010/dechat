use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    Text,
    File,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BurnMode {
    OnSend,
    OnRead,
    OnAction,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BurnConfig {
    pub mode: BurnMode,
    pub duration_secs: u32,
    pub burn_sender_copy: bool,
    pub revocable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageState {
    Normal,
    PendingBurn,
    Countdown,
    Expired,
    Revoked,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub from_self: bool,
    pub kind: MessageKind,
    pub content: Vec<u8>,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub timestamp: u64,
    pub burn: Option<BurnConfig>,
    pub state: MessageState,
    pub burn_started_at: Option<u64>,
    pub burn_remaining: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WirePayload {
    pub v: u32,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub id: String,
    pub kind: MessageKind,
    pub content: String,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub ts: u64,
    pub burn: Option<BurnConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WireNotification {
    pub v: u32,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub msg_id: String,
    pub trigger: Option<String>,
}

impl Message {
    pub fn new_text(from_self: bool, content: Vec<u8>, burn: Option<BurnConfig>) -> Self {
        let state = if burn.is_some() {
            MessageState::PendingBurn
        } else {
            MessageState::Normal
        };
        Message {
            id: Uuid::new_v4().to_string(),
            from_self,
            kind: MessageKind::Text,
            content,
            filename: None,
            mime_type: None,
            timestamp: now_millis(),
            burn,
            state,
            burn_started_at: None,
            burn_remaining: None,
        }
    }

    pub fn new_file(
        from_self: bool,
        content: Vec<u8>,
        filename: String,
        mime_type: String,
        burn: Option<BurnConfig>,
    ) -> Self {
        let state = if burn.is_some() {
            MessageState::PendingBurn
        } else {
            MessageState::Normal
        };
        Message {
            id: Uuid::new_v4().to_string(),
            from_self,
            kind: MessageKind::File,
            content,
            filename: Some(filename),
            mime_type: Some(mime_type),
            timestamp: now_millis(),
            burn,
            state,
            burn_started_at: None,
            burn_remaining: None,
        }
    }

    pub fn trigger_burn(&mut self) {
        if self.burn.is_some() && self.state == MessageState::PendingBurn {
            self.state = MessageState::Countdown;
            self.burn_started_at = Some(now_millis());
            self.burn_remaining = self.burn.as_ref().map(|b| b.duration_secs);
        }
    }

    pub fn tick(&mut self) -> bool {
        if self.state != MessageState::Countdown {
            return false;
        }
        let Some(start) = self.burn_started_at else { return false };
        let Some(config) = &self.burn else { return false };
        let elapsed = ((now_millis() - start) / 1000) as u32;
        if elapsed >= config.duration_secs {
            self.state = MessageState::Expired;
            self.content.zeroize();
            self.content.clear();
            true
        } else {
            self.burn_remaining = Some(config.duration_secs - elapsed);
            false
        }
    }

    pub fn revoke_burn(&mut self) -> bool {
        if self.burn.as_ref().map_or(false, |b| b.revocable)
            && (self.state == MessageState::PendingBurn || self.state == MessageState::Countdown)
        {
            self.state = MessageState::Revoked;
            self.burn = None;
            self.burn_started_at = None;
            self.burn_remaining = None;
            true
        } else {
            false
        }
    }

    pub fn is_expired(&self) -> bool {
        self.state == MessageState::Expired
    }

    pub fn placeholder_text(&self) -> String {
        match self.state {
            MessageState::Expired => "[消息已焚毁]".to_string(),
            _ => String::new(),
        }
    }
}

impl WirePayload {
    pub fn from_message(msg: &Message, encrypted_content: &[u8]) -> Self {
        WirePayload {
            v: 1,
            msg_type: "msg".to_string(),
            id: msg.id.clone(),
            kind: msg.kind.clone(),
            content: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, encrypted_content),
            filename: msg.filename.clone(),
            mime_type: msg.mime_type.clone(),
            ts: msg.timestamp,
            burn: msg.burn.clone(),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap()
    }

    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

impl WireNotification {
    pub fn burn_trigger(msg_id: &str, trigger: &str) -> Self {
        WireNotification {
            v: 1,
            msg_type: "burn_trigger".to_string(),
            msg_id: msg_id.to_string(),
            trigger: Some(trigger.to_string()),
        }
    }

    pub fn burn_revoke(msg_id: &str) -> Self {
        WireNotification {
            v: 1,
            msg_type: "burn_revoke".to_string(),
            msg_id: msg_id.to_string(),
            trigger: None,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap()
    }

    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

fn now_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_lifecycle() {
        let burn = BurnConfig {
            mode: BurnMode::OnRead,
            duration_secs: 5,
            burn_sender_copy: false,
            revocable: true,
        };
        let mut msg = Message::new_text(true, b"hello".to_vec(), Some(burn));
        assert_eq!(msg.state, MessageState::PendingBurn);

        msg.trigger_burn();
        assert_eq!(msg.state, MessageState::Countdown);
    }

    #[test]
    fn test_revoke_burn() {
        let burn = BurnConfig {
            mode: BurnMode::OnRead,
            duration_secs: 30,
            burn_sender_copy: false,
            revocable: true,
        };
        let mut msg = Message::new_text(true, b"secret".to_vec(), Some(burn));
        msg.trigger_burn();

        assert!(msg.revoke_burn());
        assert_eq!(msg.state, MessageState::Revoked);
        assert!(msg.burn.is_none());
    }
}
