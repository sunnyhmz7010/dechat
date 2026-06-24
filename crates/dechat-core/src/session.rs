use crate::keys::{IdentityKeyPair, PreKeyBundle, SecretKeys};
use crate::message::{BurnConfig, BurnMode, Message, WireNotification, WirePayload};
use crate::signal::RatchetState;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum SessionPhase {
    AwaitingOffer,
    AwaitingAnswer,
    Connected,
    Destroyed,
}

pub struct Session {
    pub phase: SessionPhase,
    pub identity: IdentityKeyPair,
    pub secret_keys: SecretKeys,
    pub bundle: PreKeyBundle,
    pub ratchet: Option<RatchetState>,
    pub messages: Vec<Message>,
    pub peer_fingerprint: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct OfferCode {
    pub v: u32,
    #[serde(rename = "type")]
    pub oc_type: String,
    pub ik: String,
    pub spk: String,
    pub spk_sig: String,
    pub opk: String,
    pub ek: String,
}

#[derive(Serialize, Deserialize)]
pub struct AnswerCode {
    pub v: u32,
    #[serde(rename = "type")]
    pub oc_type: String,
    pub ik: String,
    pub ek: String,
}

pub struct OfferData {
    pub json: String,
    pub fingerprint: String,
}

pub struct AnswerData {
    pub json: String,
    pub fingerprint: String,
}

impl Session {
    pub fn new() -> Self {
        let (identity, mut secret_keys) = IdentityKeyPair::generate();
        let bundle = PreKeyBundle::generate(&identity, &mut secret_keys);

        Session {
            phase: SessionPhase::AwaitingOffer,
            identity,
            secret_keys,
            bundle,
            ratchet: None,
            messages: Vec::new(),
            peer_fingerprint: None,
        }
    }

    pub fn create_offer(&self) -> Result<OfferData, String> {
        let ek = crate::keys::EphemeralKeyPair::generate();
        let offer_code = OfferCode {
            v: 1,
            oc_type: "offer".to_string(),
            ik: b64(&self.identity.public),
            spk: b64(&self.bundle.signed_prekey),
            spk_sig: b64(&self.bundle.signed_prekey_sig),
            opk: b64(&self.bundle.one_time_prekey),
            ek: b64(&ek.public),
        };
        Ok(OfferData {
            json: serde_json::to_string(&offer_code).map_err(|e| e.to_string())?,
            fingerprint: crate::keys::fingerprint(&self.identity.public),
        })
    }

    pub fn create_answer(&mut self, offer_json: &str) -> Result<AnswerData, String> {
        let offer: OfferCode = serde_json::from_str(offer_json).map_err(|e| e.to_string())?;

        let their_identity = unb64_32(&offer.ik)?;
        let their_bundle = PreKeyBundle {
            identity_key: their_identity,
            signed_prekey: unb64_32(&offer.spk)?,
            signed_prekey_sig: unb64_64(&offer.spk_sig)?,
            one_time_prekey: unb64_32(&offer.opk)?,
        };

        if !their_bundle.verify_signature() {
            return Err("Invalid signature on prekey bundle".into());
        }

        let their_ephemeral = unb64_32(&offer.ek)?;

        let ratchet = RatchetState::responder(
            &self.secret_keys,
            &self.bundle,
            &their_identity,
            &their_ephemeral,
        );

        self.ratchet = Some(ratchet);
        self.phase = SessionPhase::Connected;
        self.peer_fingerprint = Some(crate::keys::fingerprint(&their_identity));

        let ek = crate::keys::EphemeralKeyPair::generate();
        let answer_code = AnswerCode {
            v: 1,
            oc_type: "answer".to_string(),
            ik: b64(&self.identity.public),
            ek: b64(&ek.public),
        };

        Ok(AnswerData {
            json: serde_json::to_string(&answer_code).map_err(|e| e.to_string())?,
            fingerprint: self.peer_fingerprint.clone().unwrap(),
        })
    }

    pub fn complete_handshake(&mut self, answer_json: &str) -> Result<(), String> {
        let answer: AnswerCode = serde_json::from_str(answer_json).map_err(|e| e.to_string())?;

        let their_identity = unb64_32(&answer.ik)?;
        let their_ephemeral = unb64_32(&answer.ek)?;

        let (ratchet, _ek_public) = RatchetState::initiator(&self.secret_keys, &self.bundle, &their_ephemeral);
        self.ratchet = Some(ratchet);
        self.phase = SessionPhase::Connected;
        self.peer_fingerprint = Some(crate::keys::fingerprint(&their_identity));

        Ok(())
    }

    pub fn encrypt_message(&mut self, plaintext: &[u8], burn: Option<BurnConfig>) -> Result<(String, Vec<u8>), String> {
        let ratchet = self.ratchet.as_mut().ok_or("not connected")?;
        let mut msg = Message::new_text(true, plaintext.to_vec(), burn.clone());

        if let Some(ref b) = burn {
            if b.mode == BurnMode::OnSend {
                msg.trigger_burn();
            }
        }

        let wire = ratchet.encrypt(plaintext);
        let wire_bytes = serde_json::to_vec(&wire).map_err(|e| e.to_string())?;

        let payload = WirePayload::from_message(&msg, &wire_bytes);
        let payload_json = payload.to_json();

        self.messages.push(msg);

        Ok((payload_json, wire_bytes))
    }

    pub fn decrypt_message(&mut self, wire_json: &str, payload_json: &str) -> Result<Message, String> {
        let ratchet = self.ratchet.as_mut().ok_or("not connected")?;
        let wire: crate::signal::WireMessage = serde_json::from_str(wire_json).map_err(|e| e.to_string())?;
        let payload: WirePayload = serde_json::from_str(payload_json).map_err(|e| e.to_string())?;

        let plaintext = ratchet.decrypt(&wire)?;

        let mut msg = Message::new_text(false, plaintext, payload.burn.clone());
        msg.id = payload.id.clone();
        msg.timestamp = payload.ts;

        if let Some(ref b) = payload.burn {
            if b.mode == BurnMode::OnSend {
                msg.trigger_burn();
            }
        }

        self.messages.push(msg.clone());
        Ok(msg)
    }

    pub fn tick_all(&mut self) -> Vec<String> {
        let mut expired_ids = Vec::new();
        for msg in &mut self.messages {
            if msg.tick() {
                expired_ids.push(msg.id.clone());
            }
        }
        expired_ids
    }

    pub fn revoke_burn(&mut self, msg_id: &str) -> Option<WireNotification> {
        if let Some(msg) = self.messages.iter_mut().find(|m| m.id == msg_id) {
            if msg.revoke_burn() {
                return Some(WireNotification::burn_revoke(msg_id));
            }
        }
        None
    }

    pub fn trigger_read(&mut self, msg_id: &str) -> Option<WireNotification> {
        if let Some(msg) = self.messages.iter_mut().find(|m| m.id == msg_id && !m.from_self) {
            if msg.burn.as_ref().map_or(false, |b| b.mode == BurnMode::OnRead) {
                msg.trigger_burn();
                return Some(WireNotification::burn_trigger(msg_id, "read"));
            }
        }
        None
    }

    pub fn trigger_action(&mut self, msg_id: &str) -> Option<WireNotification> {
        if let Some(msg) = self.messages.iter_mut().find(|m| m.id == msg_id && !m.from_self) {
            if msg.burn.as_ref().map_or(false, |b| b.mode == BurnMode::OnAction) {
                msg.trigger_burn();
                return Some(WireNotification::burn_trigger(msg_id, "download"));
            }
        }
        None
    }

    pub fn destroy(&mut self) {
        self.secret_keys.identity_secret.zeroize();
        self.secret_keys.signed_prekey_secret.zeroize();
        self.secret_keys.one_time_prekey_secret.zeroize();
        self.secret_keys.ed_secret.zeroize();
        self.identity.secret.zeroize();
        self.identity.ed_secret.zeroize();

        for msg in &mut self.messages {
            msg.content.zeroize();
            msg.content.clear();
        }
        self.messages.clear();

        self.ratchet = None;
        self.phase = SessionPhase::Destroyed;
    }

    pub fn is_connected(&self) -> bool {
        self.phase == SessionPhase::Connected
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if self.phase != SessionPhase::Destroyed {
            self.destroy();
        }
    }
}

fn b64(data: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data)
}

fn unb64_32(s: &str) -> Result<[u8; 32], String> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s)
        .map_err(|e| e.to_string())?;
    if bytes.len() != 32 { return Err("invalid key length".into()); }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

fn unb64_64(s: &str) -> Result<[u8; 64], String> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s)
        .map_err(|e| e.to_string())?;
    if bytes.len() != 64 { return Err("invalid sig length".into()); }
    let mut arr = [0u8; 64];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}
