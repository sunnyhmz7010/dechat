use dechat_core::message::BurnConfig;
use dechat_core::session::{ICECandidate, Session};
use wasm_bindgen::prelude::*;

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

    pub fn init(&mut self) -> String {
        let session = Session::new();
        let fp = dechat_core::keys::fingerprint(&session.identity.public);
        self.session = Some(session);
        format!("{{\"fingerprint\":\"{}\",\"status\":\"initialized\"}}", fp)
    }

    pub fn create_offer(&self, sdp: &str, candidates_json: &str) -> Result<String, JsValue> {
        let session = self.session.as_ref().ok_or("not initialized")?;
        let candidates: Vec<ICECandidate> =
            serde_json::from_str(candidates_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let offer = session
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
        let session = self.session.as_mut().ok_or("not initialized")?;
        let candidates: Vec<ICECandidate> =
            serde_json::from_str(candidates_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let answer = session
            .create_answer(offer_json, sdp, candidates)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(answer.json)
    }

    pub fn complete_handshake(&mut self, answer_json: &str) -> Result<(), JsValue> {
        let session = self.session.as_mut().ok_or("not initialized")?;
        session
            .complete_handshake(answer_json)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(())
    }

    pub fn encrypt_message(&mut self, plaintext: &str, burn_json: &str) -> Result<String, JsValue> {
        let session = self.session.as_mut().ok_or("not initialized")?;
        let burn: Option<BurnConfig> = if burn_json.is_empty() {
            None
        } else {
            Some(
                serde_json::from_str(burn_json)
                    .map_err(|e| JsValue::from_str(&e.to_string()))?,
            )
        };
        let result = session.encrypt_message(plaintext.as_bytes(), burn);
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
        let session = self.session.as_mut().ok_or("not initialized")?;
        let msg = session
            .decrypt_message(wire_json, payload_json)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(String::from_utf8_lossy(&msg.content).to_string())
    }

    pub fn tick(&mut self) -> String {
        let session = self.session.as_mut().unwrap();
        let expired = session.tick_all();
        serde_json::to_string(&expired).unwrap_or_default()
    }

    pub fn trigger_read(&mut self, msg_id: &str) -> String {
        let session = self.session.as_mut().unwrap();
        let notification = session.trigger_read(msg_id);
        serde_json::to_string(&notification).unwrap_or_default()
    }

    pub fn trigger_action(&mut self, msg_id: &str) -> String {
        let session = self.session.as_mut().unwrap();
        let notification = session.trigger_action(msg_id);
        serde_json::to_string(&notification).unwrap_or_default()
    }

    pub fn revoke_burn(&mut self, msg_id: &str) -> String {
        let session = self.session.as_mut().unwrap();
        let notification = session.revoke_burn(msg_id);
        serde_json::to_string(&notification).unwrap_or_default()
    }

    pub fn get_messages(&self) -> String {
        let session = self.session.as_ref().unwrap();
        serde_json::to_string(&session.messages).unwrap_or_default()
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
