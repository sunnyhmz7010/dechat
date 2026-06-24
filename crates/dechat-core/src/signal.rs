use crate::keys::{dh, EphemeralKeyPair, PreKeyBundle, SecretKeys};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::Zeroize;

const MAX_SKIP: u32 = 1000;

#[derive(Clone, Serialize, Deserialize)]
pub struct ChainKey {
    #[serde(with = "crate::keys::bytes_serde")]
    key: [u8; 32],
    index: u32,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct MessageKeys {
    #[serde(with = "crate::keys::bytes_serde")]
    pub cipher_key: [u8; 32],
    #[serde(with = "crate::keys::bytes_serde")]
    pub mac_key: [u8; 32],
    #[serde(with = "bytes12_serde")]
    pub nonce: [u8; 12],
    pub index: u32,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DhKeyPair {
    #[serde(with = "crate::keys::bytes_serde")]
    pub public: [u8; 32],
    #[serde(with = "crate::keys::bytes_serde")]
    pub secret: [u8; 32],
}

#[derive(Clone, Serialize, Deserialize)]
pub struct RatchetState {
    #[serde(with = "crate::keys::bytes_serde")]
    root_key: [u8; 32],
    sending_chain: ChainKey,
    receiving_chain: Option<ChainKey>,
    dh_keypair: DhKeyPair,
    #[serde(with = "crate::keys::bytes_serde")]
    remote_public: [u8; 32],
    previous_chain_length: u32,
    #[serde(skip)]
    skipped_keys: Vec<([u8; 32], u32, MessageKeys)>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WireMessage {
    #[serde(with = "crate::keys::bytes_serde")]
    pub ratchet_pub: [u8; 32],
    pub prev_chain_len: u32,
    pub msg_number: u32,
    pub ciphertext: Vec<u8>,
    #[serde(with = "bytes12_serde")]
    pub nonce: [u8; 12],
}

mod bytes12_serde {
    use serde::{self, Deserialize, Deserializer, Serializer};
    use base64::{Engine, engine::general_purpose::STANDARD};

    pub fn serialize<S>(bytes: &[u8; 12], serializer: S) -> Result<S::Ok, S::Error>
    where S: Serializer {
        serializer.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 12], D::Error>
    where D: Deserializer<'de> {
        let s = String::deserialize(deserializer)?;
        let bytes = STANDARD.decode(&s).map_err(serde::de::Error::custom)?;
        if bytes.len() != 12 {
            return Err(serde::de::Error::custom("expected 12 bytes"));
        }
        let mut arr = [0u8; 12];
        arr.copy_from_slice(&bytes);
        Ok(arr)
    }
}

impl ChainKey {
    fn new(key: [u8; 32]) -> Self {
        ChainKey { key, index: 0 }
    }

    fn next(&self) -> (Self, MessageKeys) {
        let hk = Hkdf::<Sha256>::new(Some(&[0x02u8]), &self.key);
        let mut next_key = [0u8; 32];
        hk.expand(&[0x01u8], &mut next_key).unwrap();

        let mk_hk = Hkdf::<Sha256>::new(Some(&[0x01u8]), &self.key);
        let mut cipher_key = [0u8; 32];
        let mut mac_key = [0u8; 32];
        let mut nonce_bytes = [0u8; 12];
        mk_hk.expand(b"cipher", &mut cipher_key).unwrap();
        mk_hk.expand(b"mac", &mut mac_key).unwrap();
        mk_hk.expand(b"nonce", &mut nonce_bytes).unwrap();

        let mk = MessageKeys {
            cipher_key,
            mac_key,
            nonce: nonce_bytes,
            index: self.index,
        };

        (ChainKey { key: next_key, index: self.index + 1 }, mk)
    }

    fn skip_to(&mut self, target: u32) -> Vec<MessageKeys> {
        let mut keys = Vec::new();
        while self.index < target {
            let (next, mk) = self.next();
            *self = next;
            keys.push(mk);
        }
        keys
    }
}

impl DhKeyPair {
    pub fn generate() -> Self {
        let pair = EphemeralKeyPair::generate();
        DhKeyPair { public: pair.public, secret: pair.secret }
    }

    fn dh(&self, remote_public: &[u8; 32]) -> [u8; 32] {
        dh(&self.secret, remote_public)
    }
}

impl RatchetState {
    pub fn initiator(own_secret: &SecretKeys, their_bundle: &PreKeyBundle, remote_ephemeral: &[u8; 32]) -> (Self, Vec<u8>) {
        let ek = DhKeyPair::generate();

        let dh1 = dh(&own_secret.identity_secret, &their_bundle.signed_prekey);
        let dh2 = ek.dh(&their_bundle.identity_key);
        let dh3 = ek.dh(&their_bundle.signed_prekey);
        let dh4 = ek.dh(&their_bundle.one_time_prekey);

        let mut ikm = Vec::with_capacity(128);
        ikm.extend_from_slice(&[0xffu8; 32]);
        ikm.extend_from_slice(&dh1);
        ikm.extend_from_slice(&dh2);
        ikm.extend_from_slice(&dh3);
        ikm.extend_from_slice(&dh4);

        let (root_key, chain_key) = kdf_rk(&[0u8; 32], &ikm);
        ikm.zeroize();

        let dh_keypair = DhKeyPair::generate();

        let state = RatchetState {
            root_key,
            sending_chain: ChainKey::new(chain_key),
            receiving_chain: None,
            dh_keypair,
            remote_public: *remote_ephemeral,
            previous_chain_length: 0,
            skipped_keys: Vec::new(),
        };

        (state, ek.public.to_vec())
    }

    pub fn responder(
        own_secret: &SecretKeys,
        _our_bundle: &PreKeyBundle,
        their_identity: &[u8; 32],
        their_ephemeral: &[u8; 32],
    ) -> Self {
        let dh1 = dh(&own_secret.signed_prekey_secret, their_identity);
        let dh2 = dh(&own_secret.identity_secret, their_ephemeral);
        let dh3 = dh(&own_secret.signed_prekey_secret, their_ephemeral);
        let dh4 = dh(&own_secret.one_time_prekey_secret, their_ephemeral);

        let mut ikm = Vec::with_capacity(128);
        ikm.extend_from_slice(&[0xffu8; 32]);
        ikm.extend_from_slice(&dh1);
        ikm.extend_from_slice(&dh2);
        ikm.extend_from_slice(&dh3);
        ikm.extend_from_slice(&dh4);

        let (root_key, chain_key) = kdf_rk(&[0u8; 32], &ikm);
        ikm.zeroize();

        let dh_keypair = DhKeyPair::generate();

        RatchetState {
            root_key,
            sending_chain: ChainKey::new(chain_key),
            receiving_chain: None,
            dh_keypair,
            remote_public: *their_ephemeral,
            previous_chain_length: 0,
            skipped_keys: Vec::new(),
        }
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> WireMessage {
        let (next_chain, mk) = self.sending_chain.next();
        self.sending_chain = next_chain;

        let cipher = Aes256Gcm::new_from_slice(&mk.cipher_key).unwrap();
        let nonce = Nonce::from_slice(&mk.nonce);
        let ciphertext = cipher.encrypt(nonce, plaintext).expect("encryption failed");

        WireMessage {
            ratchet_pub: self.dh_keypair.public,
            prev_chain_len: self.previous_chain_length,
            msg_number: mk.index,
            ciphertext,
            nonce: mk.nonce,
        }
    }

    pub fn decrypt(&mut self, msg: &WireMessage) -> Result<Vec<u8>, String> {
        if let Some(mk) = self.try_skipped(&msg.ratchet_pub, msg.msg_number) {
            let cipher = Aes256Gcm::new_from_slice(&mk.cipher_key).unwrap();
            let nonce = Nonce::from_slice(&mk.nonce);
            return cipher.decrypt(nonce, msg.ciphertext.as_ref()).map_err(|e| e.to_string());
        }

        if msg.ratchet_pub != self.remote_public {
            self.skip_message_keys(msg.prev_chain_len)?;
            self.dh_ratchet(&msg.ratchet_pub)?;
        }

        self.skip_message_keys(msg.msg_number)?;

        let receiving = self.receiving_chain.as_mut().ok_or("no receiving chain")?;
        let (_, mk) = receiving.next();

        let cipher = Aes256Gcm::new_from_slice(&mk.cipher_key).unwrap();
        let nonce = Nonce::from_slice(&mk.nonce);
        cipher.decrypt(nonce, msg.ciphertext.as_ref()).map_err(|e| e.to_string())
    }

    fn try_skipped(&mut self, public: &[u8; 32], index: u32) -> Option<MessageKeys> {
        if let Some(pos) = self.skipped_keys.iter().position(|(pk, i, _)| pk == public && *i == index) {
            let (_, _, mk) = self.skipped_keys.remove(pos);
            Some(mk)
        } else {
            None
        }
    }

    fn skip_message_keys(&mut self, until: u32) -> Result<(), String> {
        if let Some(ref mut rc) = self.receiving_chain {
            let count = until.saturating_sub(rc.index);
            if count > MAX_SKIP {
                return Err("too many skipped messages".into());
            }
            for mk in rc.skip_to(until) {
                self.skipped_keys.push((self.remote_public, mk.index, mk));
            }
        }
        Ok(())
    }

    fn dh_ratchet(&mut self, new_public: &[u8; 32]) -> Result<(), String> {
        self.previous_chain_length = self.sending_chain.index;

        let dh_send = self.dh_keypair.dh(new_public);
        let (rk1, receiving_chain_key) = kdf_rk(&self.root_key, &dh_send);
        self.receiving_chain = Some(ChainKey::new(receiving_chain_key));

        self.dh_keypair = DhKeyPair::generate();
        let dh_recv = self.dh_keypair.dh(new_public);
        let (rk2, sending_chain_key) = kdf_rk(&rk1, &dh_recv);
        self.root_key = rk2;
        self.sending_chain = ChainKey::new(sending_chain_key);

        self.remote_public = *new_public;

        Ok(())
    }
}

fn kdf_rk(rk: &[u8; 32], dh_output: &[u8]) -> ([u8; 32], [u8; 32]) {
    let hk = Hkdf::<Sha256>::new(Some(rk), dh_output);
    let mut output = [0u8; 64];
    hk.expand(b"dechat-ratchet", &mut output).unwrap();
    let mut new_rk = [0u8; 32];
    let mut ck = [0u8; 32];
    new_rk.copy_from_slice(&output[..32]);
    ck.copy_from_slice(&output[32..]);
    (new_rk, ck)
}
