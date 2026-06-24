use ed25519_dalek::{Signer, SigningKey, VerifyingKey, Verifier, Signature};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use x25519_dalek::{PublicKey as X25519Public, StaticSecret};

#[derive(Clone, Serialize, Deserialize)]
pub struct IdentityKeyPair {
    #[serde(with = "bytes_serde")]
    pub public: [u8; 32],
    #[serde(with = "bytes_serde")]
    pub secret: [u8; 32],
    #[serde(with = "bytes_serde")]
    pub ed_public: [u8; 32],
    #[serde(with = "bytes64_serde")]
    pub ed_secret: [u8; 64],
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PreKeyBundle {
    #[serde(with = "bytes_serde")]
    pub identity_key: [u8; 32],
    #[serde(with = "bytes_serde")]
    pub ed_public_key: [u8; 32],
    #[serde(with = "bytes_serde")]
    pub signed_prekey: [u8; 32],
    #[serde(with = "bytes64_serde")]
    pub signed_prekey_sig: [u8; 64],
    #[serde(with = "bytes_serde")]
    pub one_time_prekey: [u8; 32],
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SecretKeys {
    #[serde(with = "bytes_serde")]
    pub identity_secret: [u8; 32],
    #[serde(with = "bytes_serde")]
    pub signed_prekey_secret: [u8; 32],
    #[serde(with = "bytes_serde")]
    pub one_time_prekey_secret: [u8; 32],
    #[serde(with = "bytes64_serde")]
    pub ed_secret: [u8; 64],
}

#[derive(Clone, Serialize, Deserialize)]
pub struct EphemeralKeyPair {
    #[serde(with = "bytes_serde")]
    pub public: [u8; 32],
    #[serde(with = "bytes_serde")]
    pub secret: [u8; 32],
}

impl IdentityKeyPair {
    pub fn generate() -> (Self, SecretKeys) {
        let identity_secret = StaticSecret::random_from_rng(OsRng);
        let identity_public = X25519Public::from(&identity_secret);

        let ed_signing = SigningKey::generate(&mut OsRng);
        let ed_verifying = ed_signing.verifying_key();

        let ed_secret_bytes = ed_signing.to_keypair_bytes();

        let id = IdentityKeyPair {
            public: identity_public.to_bytes(),
            secret: identity_secret.to_bytes(),
            ed_public: ed_verifying.to_bytes(),
            ed_secret: ed_secret_bytes,
        };

        let sk = SecretKeys {
            identity_secret: id.secret,
            signed_prekey_secret: [0u8; 32],
            one_time_prekey_secret: [0u8; 32],
            ed_secret: ed_secret_bytes,
        };

        (id, sk)
    }
}

impl PreKeyBundle {
    pub fn generate(identity_key: &IdentityKeyPair, secret_keys: &mut SecretKeys) -> Self {
        let spk_secret = StaticSecret::random_from_rng(OsRng);
        let spk_public = X25519Public::from(&spk_secret);

        let opk_secret = StaticSecret::random_from_rng(OsRng);
        let opk_public = X25519Public::from(&opk_secret);

        let ed_signing = SigningKey::from_keypair_bytes(&identity_key.ed_secret).unwrap();
        let spk_sig = ed_signing.sign(&spk_public.to_bytes());

        secret_keys.signed_prekey_secret = spk_secret.to_bytes();
        secret_keys.one_time_prekey_secret = opk_secret.to_bytes();

        PreKeyBundle {
            identity_key: identity_key.public,
            ed_public_key: identity_key.ed_public,
            signed_prekey: spk_public.to_bytes(),
            signed_prekey_sig: spk_sig.to_bytes(),
            one_time_prekey: opk_public.to_bytes(),
        }
    }

    pub fn verify_signature(&self) -> bool {
        let verifying_key = match VerifyingKey::from_bytes(&self.ed_public_key) {
            Ok(k) => k,
            Err(_) => return false,
        };
        let sig_arr: [u8; 64] = self.signed_prekey_sig;
        let signature = Signature::from_bytes(&sig_arr);
        verifying_key.verify(&self.signed_prekey, &signature).is_ok()
    }
}

impl EphemeralKeyPair {
    pub fn generate() -> Self {
        let secret = StaticSecret::random_from_rng(OsRng);
        let public = X25519Public::from(&secret);
        EphemeralKeyPair {
            public: public.to_bytes(),
            secret: secret.to_bytes(),
        }
    }
}

pub fn dh(secret: &[u8; 32], public: &[u8; 32]) -> [u8; 32] {
    let secret = StaticSecret::from(*secret);
    let public = X25519Public::from(*public);
    secret.diffie_hellman(&public).to_bytes()
}

pub fn fingerprint(public_key: &[u8; 32]) -> String {
    use sha2::{Sha256, Digest};
    let hash = Sha256::digest(public_key);
    hex::encode(hash)[..16].to_string()
}

pub mod bytes_serde {
    use serde::{self, Deserialize, Deserializer, Serializer};
    use base64::{Engine, engine::general_purpose::STANDARD};

    pub fn serialize<S>(bytes: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error>
    where S: Serializer {
        serializer.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 32], D::Error>
    where D: Deserializer<'de> {
        let s = String::deserialize(deserializer)?;
        let bytes = STANDARD.decode(&s).map_err(serde::de::Error::custom)?;
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(arr)
    }
}

pub mod bytes64_serde {
    use serde::{self, Deserialize, Deserializer, Serializer};
    use base64::{Engine, engine::general_purpose::STANDARD};

    pub fn serialize<S>(bytes: &[u8; 64], serializer: S) -> Result<S::Ok, S::Error>
    where S: Serializer {
        serializer.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 64], D::Error>
    where D: Deserializer<'de> {
        let s = String::deserialize(deserializer)?;
        let bytes = STANDARD.decode(&s).map_err(serde::de::Error::custom)?;
        if bytes.len() != 64 {
            return Err(serde::de::Error::custom("expected 64 bytes"));
        }
        let mut arr = [0u8; 64];
        arr.copy_from_slice(&bytes);
        Ok(arr)
    }
}
