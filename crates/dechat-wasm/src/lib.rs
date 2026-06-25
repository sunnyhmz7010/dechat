use dechat_core::message::BurnConfig;
use dechat_core::session::{ICECandidate, Session};
use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct DechatEngine {
    session: Option<Rc<RefCell<Session>>>,
}

#[wasm_bindgen]
impl DechatEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> DechatEngine {
        DechatEngine { session: None }
    }

    pub fn init(&mut self) -> String {
        let session = Session::new();
        let fp = dechat_core::keys::fingerprint(&session.identity.public);
        self.session = Some(Rc::new(RefCell::new(session)));
        format!("{{\"fingerprint\":\"{}\",\"status\":\"initialized\"}}", fp)
    }

    pub fn create_offer(&self, sdp: &str, candidates_json: &str) -> Result<String, JsValue> {
        let session = self.session.as_ref().ok_or("not initialized")?;
        let candidates: Vec<ICECandidate> =
            serde_json::from_str(candidates_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let s = session.borrow();
        let offer = s
            .create_offer(sdp, candidates)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(offer.json)
    }

    pub fn create_answer(
        &mut self,
        offer_json: &str,
        sdp: &str,
        candidates_json: &str,
    ) -> Result<String, JsValue> {
        let session = self.session.as_ref().ok_or("not initialized")?;
        let candidates: Vec<ICECandidate> =
            serde_json::from_str(candidates_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let mut s = session.borrow_mut();
        let answer = s
            .create_answer(offer_json, sdp, candidates)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(answer.json)
    }

    pub fn complete_handshake(&mut self, answer_json: &str) -> Result<(), JsValue> {
        let session = self.session.as_ref().ok_or("not initialized")?;
        let mut s = session.borrow_mut();
        s.complete_handshake(answer_json)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(())
    }

    pub fn encrypt_message(&mut self, plaintext: &str, burn_json: &str) -> Result<String, JsValue> {
        let session = self.session.as_ref().ok_or("not initialized")?;
        let burn: Option<BurnConfig> = if burn_json.is_empty() {
            None
        } else {
            Some(
                serde_json::from_str(burn_json)
                    .map_err(|e| JsValue::from_str(&e.to_string()))?,
            )
        };
        let mut s = session.borrow_mut();
        let result = s.encrypt_message(plaintext.as_bytes(), burn);
        match result {
            Ok((payload_json, wire_bytes)) => {
                let wire_json = String::from_utf8_lossy(&wire_bytes);
                Ok(format!("{{\"wire\":{},\"payload\":{}}}", wire_json, payload_json))
            }
            Err(e) => Err(JsValue::from_str(&e))
        }
    }

    pub fn decrypt_message(
        &mut self,
        wire_json: &str,
        payload_json: &str,
    ) -> Result<String, JsValue> {
        let session = self.session.as_ref().ok_or("not initialized")?;
        let mut s = session.borrow_mut();
        let msg = s
            .decrypt_message(wire_json, payload_json)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(String::from_utf8_lossy(&msg.content).to_string())
    }

    pub fn tick(&mut self) -> String {
        let session = match self.session.as_ref() {
            Some(s) => s,
            None => return "[]".to_string(),
        };
        let mut s = session.borrow_mut();
        let expired = s.tick_all();
        serde_json::to_string(&expired).unwrap_or_else(|_| "[]".to_string())
    }

    pub fn trigger_read(&mut self, msg_id: &str) -> String {
        let session = match self.session.as_ref() {
            Some(s) => s,
            None => return "null".to_string(),
        };
        let mut s = session.borrow_mut();
        let notification = s.trigger_read(msg_id);
        serde_json::to_string(&notification).unwrap_or_else(|_| "null".to_string())
    }

    pub fn trigger_action(&mut self, msg_id: &str) -> String {
        let session = match self.session.as_ref() {
            Some(s) => s,
            None => return "null".to_string(),
        };
        let mut s = session.borrow_mut();
        let notification = s.trigger_action(msg_id);
        serde_json::to_string(&notification).unwrap_or_else(|_| "null".to_string())
    }

    pub fn revoke_burn(&mut self, msg_id: &str) -> String {
        let session = match self.session.as_ref() {
            Some(s) => s,
            None => return "null".to_string(),
        };
        let mut s = session.borrow_mut();
        let notification = s.revoke_burn(msg_id);
        serde_json::to_string(&notification).unwrap_or_else(|_| "null".to_string())
    }

    pub fn get_messages(&self) -> String {
        let session = match self.session.as_ref() {
            Some(s) => s,
            None => return "[]".to_string(),
        };
        let s = session.borrow();
        serde_json::to_string(&s.messages).unwrap_or_else(|_| "[]".to_string())
    }

    pub fn is_connected(&self) -> bool {
        self.session
            .as_ref()
            .map(|s| s.borrow().is_connected())
            .unwrap_or(false)
    }

    pub fn get_fingerprint(&self) -> String {
        let session = match self.session.as_ref() {
            Some(s) => s,
            None => return String::new(),
        };
        let s = session.borrow();
        dechat_core::keys::fingerprint(&s.identity.public)
    }

    pub fn destroy(&mut self) {
        if let Some(session) = self.session.take() {
            session.borrow_mut().destroy();
        }
    }
}
