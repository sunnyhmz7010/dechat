import init, { DechatEngine } from '../pkg/dechat_wasm.js';
import { EncryptedStorage } from './storage.js';
import { generateRecoveryPhrase, verifyPhrase } from './password.js';

let engine = null;
let storage = null;
let connection = null;
let burnEnabled = false;
let burnDuration = 30;
let burnMode = 'on_read';
let burnSender = false;
let burnRevocable = true;
let escapeCount = 0;
let escapeTimer = null;
let tickInterval = null;
let hasPassword = false;
let recoveryPhrase = null;
let networkSettings = { stun: '', turn: '', turnUser: '', turnPass: '' };

function showToast(message, type = 'info', duration = 3000) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    const colors = {
        info: 'var(--color-primary-light)',
        success: 'var(--color-success)',
        error: 'var(--color-destructive)',
        warning: 'var(--color-warning)',
    };

    toast.style.cssText = `
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        background: var(--color-surface-raised); color: var(--color-foreground);
        padding: 12px 20px; border-radius: 8px; font-size: 14px;
        border: 1px solid var(--color-border); box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1000; animation: messageIn 200ms ease-out;
        display: flex; align-items: center; gap: 8px; max-width: 400px;
    `;

    const dot = document.createElement('span');
    dot.style.cssText = `width: 8px; height: 8px; border-radius: 50%; background: ${colors[type]}; flex-shrink: 0;`;
    toast.appendChild(dot);

    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeIn 150ms ease-out reverse';
        setTimeout(() => toast.remove(), 150);
    }, duration);
}

function setButtonLoading(btn, loading) {
    if (loading) {
        btn.disabled = true;
        btn._originalHTML = btn.innerHTML;
        const spinner = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="loading"><circle cx="12" cy="12" r="10" stroke-dasharray="30 70"/></svg>';
        btn.innerHTML = spinner + ' ' + btn.textContent.trim();
    } else {
        btn.disabled = false;
        if (btn._originalHTML) btn.innerHTML = btn._originalHTML;
    }
}

async function main() {
    await init();
    storage = new EncryptedStorage();
    await storage.init();

    hasPassword = await storage.getSetting('has_password') === true;
    const savedNet = await storage.getSetting('network');
    if (savedNet) networkSettings = savedNet;

    const stored = localStorage.getItem('dechat_fingerprint');
    if (stored && !hasPassword) {
        document.getElementById('fingerprint').textContent = stored;
        document.getElementById('identity-info').style.display = 'block';
    }

    if (hasPassword) {
        showLockScreen();
    }

    setupEventListeners();
}

function showLockScreen() {
    document.getElementById('lock-screen').style.display = 'flex';
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'none';
}

function setupEventListeners() {
    document.getElementById('btn-init').addEventListener('click', () => handleInit(false));
    document.getElementById('btn-init-password').addEventListener('click', showPasswordSetup);
    document.getElementById('btn-confirm-password').addEventListener('click', handlePasswordConfirm);
    document.getElementById('btn-confirm-recovery').addEventListener('click', handleRecoveryConfirmed);
    document.getElementById('btn-copy-recovery').addEventListener('click', handleCopyRecovery);

    document.getElementById('btn-unlock').addEventListener('click', handleUnlock);
    document.getElementById('btn-use-recovery').addEventListener('click', () => {
        const sec = document.getElementById('recovery-section');
        sec.style.display = sec.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('btn-recover').addEventListener('click', handleRecover);

    document.getElementById('btn-new-chat').addEventListener('click', showConnectScreen);
    document.getElementById('btn-create-offer').addEventListener('click', handleCreateOffer);
    document.getElementById('btn-accept-offer').addEventListener('click', handleAcceptOffer);
    document.getElementById('btn-copy-offer').addEventListener('click', handleCopyOffer);
    document.getElementById('btn-show-qr').addEventListener('click', handleShowQR);
    document.getElementById('btn-complete').addEventListener('click', handleComplete);
    document.getElementById('btn-send').addEventListener('click', handleSend);
    document.getElementById('btn-panic').addEventListener('click', handlePanic);
    document.getElementById('btn-burn-toggle').addEventListener('click', toggleBurnSettings);

    const btnMenu = document.getElementById('btn-menu');
    if (btnMenu) {
        btnMenu.addEventListener('click', toggleSidebar);
    }

    document.getElementById('btn-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').style.display = 'flex';
        document.getElementById('stun-server').value = networkSettings.stun;
        document.getElementById('turn-server').value = networkSettings.turn;
        document.getElementById('turn-username').value = networkSettings.turnUser;
        document.getElementById('turn-password').value = networkSettings.turnPass;
    });

    document.getElementById('btn-close-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').style.display = 'none';
    });

    document.getElementById('btn-save-network').addEventListener('click', handleSaveNetwork);
    document.getElementById('btn-lock-now').addEventListener('click', handleLockNow);
    document.getElementById('btn-show-recovery').addEventListener('click', handleShowRecovery);

    document.getElementById('msg-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });

    document.getElementById('lock-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleUnlock();
    });

    document.querySelectorAll('.duration-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            burnDuration = parseInt(e.target.dataset.seconds);
            document.getElementById('custom-duration').value = '';
        });
    });

    document.getElementById('custom-duration').addEventListener('input', (e) => {
        if (e.target.value) {
            document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
            burnDuration = parseInt(e.target.value) || 30;
        }
    });

    document.querySelectorAll('input[name="burn-mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => { burnMode = e.target.value; });
    });

    document.getElementById('burn-sender').addEventListener('change', (e) => { burnSender = e.target.checked; });
    document.getElementById('burn-revocable').addEventListener('change', (e) => { burnRevocable = e.target.checked; });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            escapeCount++;
            if (escapeTimer) clearTimeout(escapeTimer);
            escapeTimer = setTimeout(() => { escapeCount = 0; }, 1000);
            if (escapeCount >= 3) handlePanic();
        }
    });
}

function showPasswordSetup() {
    document.getElementById('password-setup').style.display = 'flex';
    document.getElementById('setup-options').style.display = 'none';
}

async function handlePasswordConfirm() {
    const pw = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-password').value;

    if (pw.length < 4) { alert('密码至少4个字符'); return; }
    if (pw !== confirm) { alert('两次密码不一致'); return; }

    recoveryPhrase = generateRecoveryPhrase();
    await storage.deriveKeyFromPassword(pw);
    await storage.saveSetting('has_password', true);
    hasPassword = true;

    document.getElementById('password-setup').style.display = 'none';
    document.getElementById('recovery-phrase-display').style.display = 'block';

    const wordsDiv = document.getElementById('recovery-words');
    wordsDiv.innerHTML = '';
    recoveryPhrase.forEach(word => {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = word;
        wordsDiv.appendChild(span);
    });
}

function handleCopyRecovery() {
    navigator.clipboard.writeText(recoveryPhrase.join(' ')).then(() => {
        const btn = document.getElementById('btn-copy-recovery');
        btn.textContent = '已复制!';
        setTimeout(() => { btn.textContent = '复制'; }, 2000);
    });
}

async function handleRecoveryConfirmed() {
    await handleInit(true);
}

async function handleInit(withPassword) {
    engine = new DechatEngine();
    const result = engine.init();

    if (!withPassword) {
        const identityBytes = new Uint8Array(32);
        crypto.getRandomValues(identityBytes);
        await storage.deriveKeyFromIdentity(identityBytes);
    }

    localStorage.setItem('dechat_fingerprint', result.fingerprint);
    await storage.saveSetting('fingerprint', result.fingerprint);

    document.getElementById('my-fingerprint').textContent = result.fingerprint;
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('lock-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'flex';
    showConnectScreen();
}

async function handleUnlock() {
    const pw = document.getElementById('lock-password').value;
    if (!pw) return;

    const btn = document.getElementById('btn-unlock');
    setButtonLoading(btn, true);

    try {
        await storage.deriveKeyFromPassword(pw);
        const fp = await storage.getSetting('fingerprint');
        if (fp) {
            engine = new DechatEngine();
            engine.init();
            document.getElementById('my-fingerprint').textContent = fp;
            document.getElementById('lock-screen').style.display = 'none';
            document.getElementById('main-screen').style.display = 'flex';
            showConnectScreen();
            showToast('已解锁', 'success');
        } else {
            showToast('密码错误或数据损坏', 'error');
        }
    } catch (e) {
        showToast('解锁失败: ' + e.message, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

async function handleRecover() {
    const phrase = document.getElementById('recovery-phrase-input').value.trim();
    const result = verifyPhrase(phrase);
    if (!result.valid) { alert(result.error); return; }

    try {
        const { phraseToSeed } = await import('./password.js');
        const seed = await phraseToSeed(phrase);
        await storage.deriveKeyFromIdentity(seed);

        const fp = await storage.getSetting('fingerprint');
        if (fp) {
            engine = new DechatEngine();
            engine.init();
            document.getElementById('my-fingerprint').textContent = fp;
            document.getElementById('lock-screen').style.display = 'none';
            document.getElementById('main-screen').style.display = 'flex';
            showConnectScreen();
        } else {
            alert('恢复短语无效');
        }
    } catch (e) {
        alert('恢复失败: ' + e.message);
    }
}

function showConnectScreen() {
    document.getElementById('connect-screen').style.display = 'flex';
    document.getElementById('chat-screen').style.display = 'none';
    document.getElementById('offer-output').style.display = 'none';
    document.getElementById('answer-input').style.display = 'none';
    document.getElementById('input-offer').value = '';
    document.getElementById('input-answer').value = '';
}

function handleCreateOffer() {
    const offerJson = engine.create_offer();
    document.getElementById('output-offer').value = offerJson;
    document.getElementById('offer-output').style.display = 'block';
    document.getElementById('answer-input').style.display = 'block';
}

function handleCopyOffer() {
    const text = document.getElementById('output-offer').value;
    navigator.clipboard.writeText(text).then(() => {
        showToast('连接码已复制到剪贴板', 'success');
    }).catch(() => {
        showToast('复制失败，请手动复制', 'error');
    });
}

function handleShowQR() {
    const text = document.getElementById('output-offer').value;
    const qrDiv = document.getElementById('qr-code');

    if (qrDiv.style.display === 'block') {
        qrDiv.style.display = 'none';
        return;
    }

    qrDiv.innerHTML = '';
    qrDiv.style.display = 'block';

    try {
        const qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        qrDiv.innerHTML = qr.createSvgTag(4, 0);
    } catch (e) {
        qrDiv.textContent = '二维码生成失败 (数据过大)';
    }
}

function handleAcceptOffer() {
    const offerJson = document.getElementById('input-offer').value.trim();
    if (!offerJson) return;

    try {
        const answerJson = engine.create_answer(offerJson);
        document.getElementById('output-offer').value = answerJson;
        document.getElementById('offer-output').style.display = 'block';
        document.getElementById('answer-input').style.display = 'none';
        setupWebRTCPeer(false);
        showToast('连接码已生成，请发送给对方', 'success');
    } catch (e) {
        showToast('连接码无效: ' + e, 'error');
    }
}

function handleComplete() {
    const answerJson = document.getElementById('input-answer').value.trim();
    if (!answerJson) return;

    try {
        engine.complete_handshake(answerJson);
        setupWebRTCPeer(true);
        enterChatScreen();
        showToast('加密连接已建立', 'success');
    } catch (e) {
        showToast('连接码无效: ' + e, 'error');
    }
}

function getRTCConfig() {
    const iceServers = [];

    if (networkSettings.stun) {
        iceServers.push({ urls: networkSettings.stun });
    }

    if (networkSettings.turn) {
        iceServers.push({
            urls: networkSettings.turn,
            username: networkSettings.turnUser,
            credential: networkSettings.turnPass,
        });
    }

    return { iceServers };
}

function setupWebRTCPeer(isInitiator) {
    connection = new SimpleP2P(isInitiator, getRTCConfig(), onMessageReceived, onConnected, onDisconnected);
}

function enterChatScreen() {
    document.getElementById('connect-screen').style.display = 'none';
    document.getElementById('chat-screen').style.display = 'flex';
    document.getElementById('peer-fingerprint').textContent = '已连接';
    document.getElementById('connection-status').textContent = '在线';

    const mobileHeader = document.getElementById('mobile-header');
    if (mobileHeader && window.innerWidth <= 768) {
        mobileHeader.style.display = 'flex';
    }

    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.classList.remove('active');

    tickInterval = setInterval(() => {
        const expired = engine.tick();
        if (expired && expired.length > 0) {
            expired.forEach(id => {
                const el = document.querySelector(`[data-msg-id="${id}"]`);
                if (el) {
                    el.classList.add('burning');
                    setTimeout(() => {
                        el.classList.remove('burning');
                        el.classList.add('expired');
                        el.innerHTML = '[消息已焚毁]';
                    }, 1500);
                }
            });
        }
    }, 1000);
}

async function handleSend() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;

    let burnJson = '';
    if (burnEnabled) {
        burnJson = JSON.stringify({
            mode: burnMode,
            duration_secs: burnDuration,
            burn_sender_copy: burnSender,
            revocable: burnRevocable,
        });
    }

    try {
        const payloadJson = engine.encrypt_message(text, burnJson);
        const payload = JSON.parse(payloadJson);

        if (connection && connection.isConnected) {
            connection.sendMessage(payloadJson);
        }

        addMessageToUI(payload, true, burnEnabled);
        input.value = '';

        if (!burnEnabled) {
            await storage.saveMessage('current', {
                id: payload.id,
                content: text,
                fromSelf: true,
                timestamp: payload.ts,
                kind: 'text',
            });
        }
    } catch (e) {
        console.error('Send error:', e);
    }
}

function onMessageReceived(payloadJson) {
    try {
        const payload = JSON.parse(payloadJson);
        const isBurn = payload.burn != null;
        addMessageToUI(payload, false, isBurn);

        if (isBurn && payload.burn.mode === 'on_read') {
            engine.trigger_read(payload.id);
        }
    } catch (e) {
        console.error('Receive error:', e);
    }
}

function onConnected() {
    const status = document.getElementById('connection-status');
    status.textContent = '在线';
    status.style.background = 'var(--color-accent-dim)';
    status.style.color = 'var(--color-accent)';
}

function onDisconnected() {
    const status = document.getElementById('connection-status');
    status.textContent = '离线';
    status.style.background = 'var(--color-destructive-dim)';
    status.style.color = 'var(--color-destructive)';
    showToast('连接已断开', 'warning');
}

function addMessageToUI(payload, isSelf, isBurn) {
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = `message ${isSelf ? 'self' : 'other'}`;
    div.dataset.msgId = payload.id;

    if (isBurn) div.classList.add('burn');

    const content = document.createElement('div');
    content.className = 'content';

    if (payload.kind === 'file' && payload.filename) {
        content.innerHTML = `📎 ${payload.filename}`;
    } else {
        content.textContent = payload.content || '[encrypted]';
    }

    div.appendChild(content);

    if (isBurn && payload.burn) {
        const indicator = document.createElement('div');
        indicator.className = 'burn-indicator';
        const modeText = { 'on_send': '发送后计时', 'on_read': '阅读后计时', 'on_action': '操作后计时' };
        indicator.textContent = `⏱ ${modeText[payload.burn.mode] || ''} ${payload.burn.duration_secs}s`;
        div.appendChild(indicator);

        if (payload.burn.mode === 'on_send') {
            startCountdown(div, payload.id, payload.burn.duration_secs);
        }

        if (payload.burn.revocable && isSelf) {
            const revokeBtn = document.createElement('div');
            revokeBtn.className = 'revoke-btn';
            revokeBtn.textContent = '撤销焚毁';
            revokeBtn.addEventListener('click', () => {
                engine.revoke_burn(payload.id);
                div.classList.remove('burn');
                indicator.remove();
                revokeBtn.remove();
            });
            div.appendChild(revokeBtn);
        }
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function startCountdown(msgEl, msgId, duration) {
    let remaining = duration;
    const countdownEl = document.createElement('div');
    countdownEl.className = 'countdown';
    countdownEl.textContent = `${remaining}s`;
    msgEl.appendChild(countdownEl);

    const bar = document.createElement('div');
    bar.className = 'countdown-bar';
    bar.style.width = '100%';
    msgEl.appendChild(bar);

    const interval = setInterval(() => {
        remaining--;
        countdownEl.textContent = `${remaining}s`;
        bar.style.width = `${(remaining / duration) * 100}%`;

        if (remaining <= 0) {
            clearInterval(interval);
            msgEl.classList.add('burning');
            setTimeout(() => {
                msgEl.classList.remove('burning');
                msgEl.classList.add('expired');
                msgEl.innerHTML = '[消息已焚毁]';
            }, 1500);
        }
    }, 1000);
}

function toggleBurnSettings() {
    const panel = document.getElementById('burn-settings');
    burnEnabled = !burnEnabled;
    panel.style.display = burnEnabled ? 'block' : 'none';
    document.getElementById('btn-burn-toggle').setAttribute('aria-pressed', burnEnabled);
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    if (sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
    } else {
        sidebar.classList.add('open');
        if (!overlay) {
            const div = document.createElement('div');
            div.className = 'sidebar-overlay active';
            div.addEventListener('click', toggleSidebar);
            document.getElementById('main-screen').appendChild(div);
        } else {
            overlay.classList.add('active');
        }
    }
}

async function handleSaveNetwork() {
    networkSettings = {
        stun: document.getElementById('stun-server').value.trim(),
        turn: document.getElementById('turn-server').value.trim(),
        turnUser: document.getElementById('turn-username').value.trim(),
        turnPass: document.getElementById('turn-password').value.trim(),
    };
    await storage.saveSetting('network', networkSettings);
    showToast('网络设置已保存', 'success');
}

function handleLockNow() {
    document.getElementById('settings-modal').style.display = 'none';
    engine = null;
    showLockScreen();
}

async function handleShowRecovery() {
    alert('恢复短语功能需要在设置密码时保存。如需重新生成，请重置密码。');
}

async function handlePanic() {
    if (!confirm('确定要销毁所有数据吗？此操作不可逆。')) return;

    if (engine) engine.destroy();
    if (storage) await storage.destroy();
    localStorage.clear();

    document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100dvh;flex-direction:column;gap:24px;background:var(--color-background);">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-destructive)" stroke-width="1.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <h1 style="color:var(--color-foreground);font-size:2rem;font-weight:700;">数据已销毁</h1>
            <p style="color:var(--color-foreground-secondary);font-size:0.875rem;">所有密钥和消息已永久删除</p>
            <button onclick="location.reload()" class="btn btn-primary" style="padding:12px 24px;font-size:1rem;">重新开始</button>
        </div>
    `;
}

class SimpleP2P {
    constructor(isInitiator, rtcConfig, onMessage, onConnect, onDisconnect) {
        this.isInitiator = isInitiator;
        this.onMessage = onMessage;
        this.onConnect = onConnect;
        this.onDisconnect = onDisconnect;
        this.isConnected = false;
        this.pc = null;
        this.channel = null;

        this.pc = new RTCPeerConnection(rtcConfig);

        this.pc.oniceconnectionstatechange = () => {
            if (this.pc.iceConnectionState === 'connected') {
                this.isConnected = true;
                this.onConnect();
            } else if (this.pc.iceConnectionState === 'disconnected' || this.pc.iceConnectionState === 'failed') {
                this.isConnected = false;
                this.onDisconnect();
            }
        };

        if (isInitiator) {
            this.channel = this.pc.createDataChannel('dechat');
            this.setupChannel(this.channel);
        } else {
            this.pc.ondatachannel = (e) => { this.setupChannel(e.channel); };
        }
    }

    setupChannel(channel) {
        channel.onopen = () => { this.isConnected = true; this.onConnect(); };
        channel.onclose = () => { this.isConnected = false; this.onDisconnect(); };
        channel.onmessage = (e) => { this.onMessage(e.data); };
    }

    sendMessage(data) {
        if (this.channel && this.channel.readyState === 'open') {
            this.channel.send(data);
        }
    }
}

main().catch(console.error);
