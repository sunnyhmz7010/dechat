use sealedchat_core::message::BurnConfig;
use sealedchat_core::session::{ICECandidate, Session};
use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct SealedChatEngine {
    session: Rc<RefCell<Option<Session>>>,
}

#[wasm_bindgen]
impl SealedChatEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SealedChatEngine {
        SealedChatEngine {
            session: Rc::new(RefCell::new(None)),
        }
    }

    pub fn init(&self) -> String {
        let session = Session::new();
        let fp = sealedchat_core::keys::fingerprint(&session.identity.public);
        *self.session.borrow_mut() = Some(session);
        format!("{{\"fingerprint\":\"{}\",\"status\":\"initialized\"}}", fp)
    }

    pub fn create_offer(&self, sdp: &str, candidates_json: &str) -> Result<String, String> {
        let candidates: Vec<ICECandidate> =
            serde_json::from_str(candidates_json).map_err(|e| e.to_string())?;
        let mut guard = self.session.borrow_mut();
        let session = guard.as_mut().ok_or("not initialized")?;
        let offer = session.create_offer(sdp, candidates)?;
        Ok(offer.json)
    }

    pub fn create_answer(
        &self,
        offer_json: &str,
        sdp: &str,
        candidates_json: &str,
    ) -> Result<String, String> {
        let candidates: Vec<ICECandidate> =
            serde_json::from_str(candidates_json).map_err(|e| e.to_string())?;
        let mut guard = self.session.borrow_mut();
        let session = guard.as_mut().ok_or("not initialized")?;
        let answer = session.create_answer(offer_json, sdp, candidates)?;
        Ok(answer.json)
    }

    pub fn complete_handshake(&self, answer_json: &str) -> Result<(), String> {
        let mut guard = self.session.borrow_mut();
        let session = guard.as_mut().ok_or("not initialized")?;
        session.complete_handshake(answer_json)?;
        Ok(())
    }

    pub fn encrypt_message(&self, plaintext: &str, burn_json: &str) -> Result<String, String> {
        let burn: Option<BurnConfig> = if burn_json.is_empty() {
            None
        } else {
            Some(serde_json::from_str(burn_json).map_err(|e| e.to_string())?)
        };
        let mut guard = self.session.borrow_mut();
        let session = guard.as_mut().ok_or("not initialized")?;
        let (payload_json, wire_bytes) = session.encrypt_message(plaintext.as_bytes(), burn)?;
        let wire_json = String::from_utf8_lossy(&wire_bytes);
        Ok(format!("{{\"wire\":{},\"payload\":{}}}", wire_json, payload_json))
    }

    pub fn decrypt_message(
        &self,
        wire_json: &str,
        payload_json: &str,
    ) -> Result<String, String> {
        let mut guard = self.session.borrow_mut();
        let session = guard.as_mut().ok_or("not initialized")?;
        let msg = session.decrypt_message(wire_json, payload_json)?;
        Ok(String::from_utf8_lossy(&msg.content).to_string())
    }

    pub fn tick(&self) -> String {
        let mut guard = self.session.borrow_mut();
        if let Some(ref mut session) = *guard {
            let expired = session.tick_all();
            serde_json::to_string(&expired).unwrap_or_else(|_| "[]".to_string())
        } else {
            "[]".to_string()
        }
    }

    pub fn trigger_read(&self, msg_id: &str) -> String {
        let mut guard = self.session.borrow_mut();
        if let Some(ref mut session) = *guard {
            let notification = session.trigger_read(msg_id);
            serde_json::to_string(&notification).unwrap_or_else(|_| "null".to_string())
        } else {
            "null".to_string()
        }
    }

    pub fn trigger_action(&self, msg_id: &str) -> String {
        let mut guard = self.session.borrow_mut();
        if let Some(ref mut session) = *guard {
            let notification = session.trigger_action(msg_id);
            serde_json::to_string(&notification).unwrap_or_else(|_| "null".to_string())
        } else {
            "null".to_string()
        }
    }

    pub fn revoke_burn(&self, msg_id: &str) -> String {
        let mut guard = self.session.borrow_mut();
        if let Some(ref mut session) = *guard {
            let notification = session.revoke_burn(msg_id);
            serde_json::to_string(&notification).unwrap_or_else(|_| "null".to_string())
        } else {
            "null".to_string()
        }
    }

    pub fn get_messages(&self) -> String {
        let guard = self.session.borrow();
        if let Some(ref session) = *guard {
            serde_json::to_string(&session.messages).unwrap_or_else(|_| "[]".to_string())
        } else {
            "[]".to_string()
        }
    }

    pub fn is_connected(&self) -> bool {
        let guard = self.session.borrow();
        guard.as_ref().map_or(false, |s| s.is_connected())
    }

    pub fn get_fingerprint(&self) -> String {
        let guard = self.session.borrow();
        guard
            .as_ref()
            .map(|s| sealedchat_core::keys::fingerprint(&s.identity.public))
            .unwrap_or_default()
    }

    pub fn destroy(&self) {
        let mut guard = self.session.borrow_mut();
        if let Some(ref mut session) = *guard {
            session.destroy();
        }
        *guard = None;
    }
}
