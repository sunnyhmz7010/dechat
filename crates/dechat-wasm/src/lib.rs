use wasm_bindgen::prelude::*;
use dechat_core::session::Session;
use dechat_core::message::BurnConfig;
use serde::{Deserialize, Serialize};

#[wasm_bindgen]
pub struct DechatEngine {
    session: Option<Session>,
}

#[wasm_bindgen]
impl DechatEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> DechatEngine {
        DechatEngine { session: None }
    }

    pub fn init(&mut self) -> JsValue {
        let session = Session::new();
        let fp = dechat_core::keys::fingerprint(&session.identity.public);
        self.session = Some(session);
        serde_wasm_bindgen::to_value(&InitResult {
            fingerprint: fp,
            status: "initialized".to_string(),
        }).unwrap()
    }

    pub fn create_offer(&self) -> Result<String, JsValue> {
        let session = self.session.as_ref().ok_or("not initialized")?;
        let offer = session.create_offer().map_err(|e| JsValue::from_str(&e))?;
        Ok(offer.json)
    }

    pub fn create_answer(&mut self, offer_json: &str) -> Result<String, JsValue> {
        let session = self.session.as_mut().ok_or("not initialized")?;
        let answer = session.create_answer(offer_json).map_err(|e| JsValue::from_str(&e))?;
        Ok(answer.json)
    }

    pub fn complete_handshake(&mut self, answer_json: &str) -> Result<(), JsValue> {
        let session = self.session.as_mut().ok_or("not initialized")?;
        session.complete_handshake(answer_json).map_err(|e| JsValue::from_str(&e))?;
        Ok(())
    }

    pub fn encrypt_message(&mut self, plaintext: &str, burn_json: &str) -> Result<String, JsValue> {
        let session = self.session.as_mut().ok_or("not initialized")?;
        let burn: Option<BurnConfig> = if burn_json.is_empty() {
            None
        } else {
            Some(serde_json::from_str(burn_json).map_err(|e| JsValue::from_str(&e.to_string()))?)
        };
        let (payload_json, _wire_bytes) = session.encrypt_message(plaintext.as_bytes(), burn)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(payload_json)
    }

    pub fn decrypt_message(&mut self, wire_json: &str, payload_json: &str) -> Result<String, JsValue> {
        let session = self.session.as_mut().ok_or("not initialized")?;
        let msg = session.decrypt_message(wire_json, payload_json)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(String::from_utf8_lossy(&msg.content).to_string())
    }

    pub fn tick(&mut self) -> JsValue {
        let session = self.session.as_mut().unwrap();
        let expired = session.tick_all();
        serde_wasm_bindgen::to_value(&expired).unwrap()
    }

    pub fn trigger_read(&mut self, msg_id: &str) -> JsValue {
        let session = self.session.as_mut().unwrap();
        let notification = session.trigger_read(msg_id);
        serde_wasm_bindgen::to_value(&notification).unwrap()
    }

    pub fn trigger_action(&mut self, msg_id: &str) -> JsValue {
        let session = self.session.as_mut().unwrap();
        let notification = session.trigger_action(msg_id);
        serde_wasm_bindgen::to_value(&notification).unwrap()
    }

    pub fn revoke_burn(&mut self, msg_id: &str) -> JsValue {
        let session = self.session.as_mut().unwrap();
        let notification = session.revoke_burn(msg_id);
        serde_wasm_bindgen::to_value(&notification).unwrap()
    }

    pub fn get_messages(&self) -> JsValue {
        let session = self.session.as_ref().unwrap();
        serde_wasm_bindgen::to_value(&session.messages).unwrap()
    }

    pub fn is_connected(&self) -> bool {
        self.session.as_ref().map_or(false, |s| s.is_connected())
    }

    pub fn get_fingerprint(&self) -> String {
        let session = self.session.as_ref().unwrap();
        dechat_core::keys::fingerprint(&session.identity.public)
    }

    pub fn destroy(&mut self) {
        if let Some(ref mut session) = self.session {
            session.destroy();
        }
        self.session = None;
    }
}

#[derive(Serialize, Deserialize)]
struct InitResult {
    fingerprint: String,
    status: String,
}
