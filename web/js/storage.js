const DB_NAME = 'sealedchat';
const DB_VERSION = 1;

export class EncryptedStorage {
    constructor() {
        this.db = null;
        this.storageKey = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('keys')) {
                    db.createObjectStore('keys', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('messages')) {
                    db.createObjectStore('messages', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('sessions')) {
                    db.createObjectStore('sessions', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'id' });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };

            request.onerror = (e) => reject(e.target.error);
        });
    }

    async deriveKey(password, salt) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
        );

        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async deriveKeyFromPassword(password) {
        let salt;
        const existing = await this.getSetting('salt');
        if (existing) {
            salt = new Uint8Array(existing);
        } else {
            salt = crypto.getRandomValues(new Uint8Array(16));
            await this.saveSetting('salt', Array.from(salt));
        }
        this.storageKey = await this.deriveKey(password, salt);
        return this.storageKey;
    }

    async deriveKeyFromIdentity(identityKeyBytes) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw', identityKeyBytes, 'PBKDF2', false, ['deriveKey']
        );

        const salt = enc.encode('sealedchat-identity-salt');
        this.storageKey = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 10000, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
        return this.storageKey;
    }

    async encrypt(plaintext) {
        if (!this.storageKey) throw new Error('No storage key');
        const enc = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            this.storageKey,
            enc.encode(plaintext)
        );
        return { ciphertext: Array.from(new Uint8Array(ciphertext)), iv: Array.from(iv) };
    }

    async decrypt(encrypted) {
        if (!this.storageKey) throw new Error('No storage key');
        const dec = new TextDecoder();
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) },
            this.storageKey,
            new Uint8Array(encrypted.ciphertext)
        );
        return dec.decode(plaintext);
    }

    async saveMessage(sessionId, messageData) {
        const encrypted = await this.encrypt(JSON.stringify(messageData));
        return this._put('messages', {
            id: `${sessionId}_${messageData.id}`,
            sessionId,
            encrypted,
            timestamp: messageData.timestamp || Date.now(),
        });
    }

    async loadMessages(sessionId) {
        const all = await this._getAll('messages');
        const sessionMessages = all.filter(m => m.sessionId === sessionId);
        const decrypted = [];
        for (const msg of sessionMessages) {
            try {
                const data = JSON.parse(await this.decrypt(msg.encrypted));
                decrypted.push(data);
            } catch (e) {
                console.warn('Failed to decrypt message:', e);
            }
        }
        return decrypted.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }

    async deleteMessage(messageId) {
        return this._delete('messages', messageId);
    }

    async clearAllMessages() {
        return this._clear('messages');
    }

    async saveSession(sessionData) {
        const encrypted = await this.encrypt(JSON.stringify(sessionData));
        return this._put('sessions', { id: sessionData.id, encrypted });
    }

    async loadSessions() {
        const all = await this._getAll('sessions');
        const decrypted = [];
        for (const s of all) {
            try {
                decrypted.push(JSON.parse(await this.decrypt(s.encrypted)));
            } catch (e) {}
        }
        return decrypted;
    }

    async saveSetting(key, value) {
        return this._put('settings', { id: key, value });
    }

    async getSetting(key) {
        const result = await this._get('settings', key);
        return result ? result.value : null;
    }

    async deleteSetting(key) {
        return this._delete('settings', key);
    }

    async saveIdentity(identityData) {
        return this._put('keys', { id: 'identity', ...identityData });
    }

    async loadIdentity() {
        return this._get('keys', 'identity');
    }

    async destroy() {
        if (this.db) {
            this.db.close();
        }
        this.storageKey = null;
        return new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
        });
    }

    _put(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(data);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    _get(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    _getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    _delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    _clear(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
}
