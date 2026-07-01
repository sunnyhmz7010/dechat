import init, { SealedChatEngine } from '../pkg/sealedchat_wasm.js';
import { EncryptedStorage } from './storage.js';
import { generateRecoveryPhrase, verifyPhrase } from './password.js';
import { base62Encode, base62Decode } from './encoding.js';

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

const sessions = new Map();
let currentSessionId = null;

function createSession(peerName) {
    const id = 'session_' + Date.now();
    const engineInstance = new SealedChatEngine();
    engineInstance.init();

    const session = {
        id,
        engine: engineInstance,
        connection: null,
        peerName: peerName || '新连接',
        fingerprint: engineInstance.get_fingerprint(),
        messages: [],
        unread: 0,
        lastActivity: Date.now(),
    };

    sessions.set(id, session);
    renderSessionList();
    switchSession(id);
    return session;
}

function switchSession(id) {
    currentSessionId = id;
    const session = sessions.get(id);
    if (!session) return;

    engine = session.engine;
    connection = session.connection;
    session.unread = 0;
    session.lastActivity = Date.now();

    document.getElementById('my-fingerprint').textContent = session.fingerprint;
    renderSessionList();

    if (session.connection && session.connection.isConnected) {
        document.getElementById('connect-screen').style.display = 'none';
        document.getElementById('chat-screen').style.display = 'flex';
        document.getElementById('peer-fingerprint').textContent = session.peerName;
        document.getElementById('connection-status').textContent = '在线';
        document.getElementById('connection-status').style.background = 'var(--color-accent-dim)';
        document.getElementById('connection-status').style.color = 'var(--color-accent)';
    } else {
        showConnectScreen();
    }

    renderMessages();
}

function deleteSession(id) {
    const session = sessions.get(id);
    if (session) {
        if (session.connection) session.connection.close();
        session.engine.destroy();
        sessions.delete(id);
    }

    if (currentSessionId === id) {
        currentSessionId = null;
        engine = null;
        connection = null;
        showConnectScreen();
    }

    renderSessionList();
}

function renderSessionList() {
    const list = document.getElementById('session-list');
    if (sessions.size === 0) {
        list.innerHTML = '<div style="padding: 24px 16px; text-align: center; color: var(--color-foreground-muted); font-size: var(--text-sm);">暂无会话，点击"新建"开始</div>';
        return;
    }

    list.innerHTML = '';
    const sorted = [...sessions.values()].sort((a, b) => b.lastActivity - a.lastActivity);

    for (const s of sorted) {
        const item = document.createElement('div');
        item.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
        item.setAttribute('role', 'listitem');

        const connected = s.connection && s.connection.isConnected;
        const statusDot = connected
            ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--color-accent);flex-shrink:0;"></span>'
            : '<span style="width:8px;height:8px;border-radius:50%;background:var(--color-foreground-muted);flex-shrink:0;"></span>';

        item.innerHTML = `
            ${statusDot}
            <div style="flex:1;min-width:0;">
                <div style="font-size:var(--text-sm);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.peerName}</div>
                <div style="font-size:11px;color:var(--color-foreground-muted);">${connected ? '在线' : '离线'}</div>
            </div>
            ${s.unread > 0 ? `<span style="background:var(--color-primary-light);color:#fff;font-size:11px;padding:2px 6px;border-radius:10px;">${s.unread}</span>` : ''}
            <button class="btn btn-icon btn-ghost btn-sm delete-session" data-id="${s.id}" aria-label="删除会话" style="opacity:0.5;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;

        item.addEventListener('click', (e) => {
            if (e.target.closest('.delete-session')) return;
            switchSession(s.id);
        });

        const delBtn = item.querySelector('.delete-session');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`删除与 "${s.peerName}" 的会话？`)) {
                    deleteSession(s.id);
                }
            });
        }

        list.appendChild(item);
    }
}

function renderMessages() {
    const container = document.getElementById('messages');
    container.innerHTML = '';

    const session = sessions.get(currentSessionId);
    if (!session) return;

    for (const msg of session.messages) {
        addMessageToUI(msg.payload, msg.fromSelf, msg.isBurn, false);
    }

    container.scrollTop = container.scrollHeight;
}

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
    try {
        console.log('main: initializing WASM...');
        await init();
        console.log('main: WASM initialized');

        console.log('main: creating storage...');
        storage = new EncryptedStorage();
        await storage.init();
        console.log('main: storage initialized');

        hasPassword = await storage.getSetting('has_password') === true;
        const savedNet = await storage.getSetting('network');
        if (savedNet) networkSettings = savedNet;

        const stored = localStorage.getItem('sealedchat_fingerprint');
        if (stored && !hasPassword) {
            document.getElementById('fingerprint').textContent = stored;
            document.getElementById('identity-info').style.display = 'block';
        }

        if (hasPassword) {
            showLockScreen();
        }

        console.log('main: setting up event listeners...');
        setupEventListeners();
        setupFileTransfer();
        setupTypingIndicator();
        setupNotifications();
        console.log('main: ready');
    } catch (e) {
        console.error('main() error:', e);
        showToast('应用初始化失败: ' + e.message, 'error');
    }
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

    document.getElementById('btn-new-chat').addEventListener('click', () => {
        createSession('新连接');
        showConnectScreen();
    });
    document.getElementById('btn-create-room').addEventListener('click', handleCreateRoom);
    document.getElementById('btn-join-room').addEventListener('click', handleJoinRoom);
    document.getElementById('btn-copy-room-code').addEventListener('click', handleCopyRoomCode);
    document.getElementById('btn-show-qr').addEventListener('click', handleShowQR);
    document.getElementById('btn-join-confirm').addEventListener('click', handleJoinConfirm);
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
    try {
        createSession('新连接');
        const session = sessions.get(currentSessionId);

        localStorage.setItem('sealedchat_fingerprint', session.fingerprint);
        await storage.saveSetting('fingerprint', session.fingerprint);

        document.getElementById('my-fingerprint').textContent = session.fingerprint;
        document.getElementById('setup-screen').style.display = 'none';
        document.getElementById('lock-screen').style.display = 'none';
        document.getElementById('main-screen').style.display = 'flex';
        showConnectScreen();
    } catch (e) {
        console.error('handleInit error:', e);
        showToast('初始化失败: ' + e.message, 'error');
    }
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
            createSession('已恢复');
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
            createSession('已恢复');
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

async function handleCreateRoom() {
    const btn = document.getElementById('btn-create-room');
    setButtonLoading(btn, true);

    try {
        const session = sessions.get(currentSessionId);
        const conn = new SimpleP2P(getRTCConfig(), onMessageReceived, onConnected, onDisconnected);
        session.connection = conn;
        connection = conn;

        showToast('正在创建房间...', 'info');
        const { sdp, candidates } = await conn.createOffer();
        const offerJson = engine.create_offer(sdp, JSON.stringify(candidates));
        
        const roomId = Math.random().toString(36).substring(2, 10);
        const roomData = {
            v: 1,
            type: 'room',
            id: roomId,
            offer: offerJson
        };
        
        const compressed = pako.gzip(JSON.stringify(roomData));
        const roomCode = base62Encode(compressed);
        
        document.getElementById('output-room-code').value = roomCode;
        document.getElementById('room-output').style.display = 'block';
        document.getElementById('join-input').style.display = 'none';
        
        showToast('房间已创建，等待其他人加入', 'success');
    } catch (e) {
        showToast('创建房间失败: ' + e.message, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

function handleJoinRoom() {
    document.getElementById('room-output').style.display = 'none';
    document.getElementById('join-input').style.display = 'block';
}

function handleCopyRoomCode() {
    const text = document.getElementById('output-room-code').value;
    navigator.clipboard.writeText(text).then(() => {
        showToast('房间码已复制到剪贴板', 'success');
    }).catch(() => {
        showToast('复制失败，请手动复制', 'error');
    });
}

async function handleJoinConfirm() {
    const roomCode = document.getElementById('input-room-code').value.trim();
    if (!roomCode) return;

    const btn = document.getElementById('btn-join-confirm');
    setButtonLoading(btn, true);

    try {
        const compressed = base62Decode(roomCode);
        const roomDataStr = pako.ungzip(compressed, { to: 'string' });
        const roomData = JSON.parse(roomDataStr);
        
        if (roomData.v !== 1 || roomData.type !== 'room') {
            throw new Error('无效的房间码');
        }
        
        const session = sessions.get(currentSessionId);
        const offerJson = roomData.offer;
        const offer = JSON.parse(offerJson);
        const offerSdp = atob(offer.webrtc.sdp);
        const offerCandidates = offer.webrtc.candidates;

        const conn = new SimpleP2P(getRTCConfig(), onMessageReceived, onConnected, onDisconnected);
        session.connection = conn;
        connection = conn;

        showToast('正在加入房间...', 'info');
        const { sdp, candidates } = await conn.createAnswer(offerSdp, offerCandidates);

        const answerJson = engine.create_answer(offerJson, sdp, JSON.stringify(candidates));
        document.getElementById('output-room-code').value = answerJson;
        document.getElementById('room-output').style.display = 'block';
        document.getElementById('join-input').style.display = 'none';

        showToast('已加入房间，连接建立中...', 'success');
    } catch (e) {
        showToast('加入房间失败: ' + e.message, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

async function handleCreateOffer() {
    const btn = document.getElementById('btn-create-offer');
    setButtonLoading(btn, true);

    try {
        const session = sessions.get(currentSessionId);
        const conn = new SimpleP2P(getRTCConfig(), onMessageReceived, onConnected, onDisconnected);
        session.connection = conn;
        connection = conn;

        showToast('正在收集网络信息...', 'info');
        const { sdp, candidates } = await conn.createOffer();
        const offerJson = engine.create_offer(sdp, JSON.stringify(candidates));
        document.getElementById('output-offer').value = offerJson;
        document.getElementById('offer-output').style.display = 'block';
        document.getElementById('answer-input').style.display = 'block';
    } catch (e) {
        showToast('生成连接码失败: ' + e.message, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
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
    const text = document.getElementById('output-room-code').value;
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

async function handleAcceptOffer() {
    const offerJson = document.getElementById('input-offer').value.trim();
    if (!offerJson) return;

    const btn = document.getElementById('btn-accept-offer');
    setButtonLoading(btn, true);

    try {
        const session = sessions.get(currentSessionId);
        const offer = JSON.parse(offerJson);
        const offerSdp = atob(offer.webrtc.sdp);
        const offerCandidates = offer.webrtc.candidates;

        const conn = new SimpleP2P(getRTCConfig(), onMessageReceived, onConnected, onDisconnected);
        session.connection = conn;
        connection = conn;

        showToast('正在收集网络信息...', 'info');
        const { sdp, candidates } = await conn.createAnswer(offerSdp, offerCandidates);

        const answerJson = engine.create_answer(offerJson, sdp, JSON.stringify(candidates));
        document.getElementById('output-offer').value = answerJson;
        document.getElementById('offer-output').style.display = 'block';
        document.getElementById('answer-input').style.display = 'none';

        if (offer.crypto) {
            session.peerName = '对方';
        }

        showToast('连接码已生成，请发送给对方', 'success');
    } catch (e) {
        showToast('连接码无效: ' + e, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

async function handleComplete() {
    const answerJson = document.getElementById('input-answer').value.trim();
    if (!answerJson) return;

    const btn = document.getElementById('btn-complete');
    setButtonLoading(btn, true);

    try {
        const answer = JSON.parse(answerJson);
        const answerSdp = atob(answer.webrtc.sdp);
        const answerCandidates = answer.webrtc.candidates;

        await connection.acceptAnswer(answerSdp, answerCandidates);
        engine.complete_handshake(answerJson);
        enterChatScreen();
        showToast('正在建立连接...', 'info');
    } catch (e) {
        showToast('连接码无效: ' + e, 'error');
    } finally {
        setButtonLoading(btn, false);
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

function enterChatScreen() {
    document.getElementById('connect-screen').style.display = 'none';
    document.getElementById('chat-screen').style.display = 'flex';
    document.getElementById('peer-fingerprint').textContent = '已连接';

    const status = document.getElementById('connection-status');
    status.textContent = '连接中...';
    status.style.background = 'var(--color-warning-dim)';
    status.style.color = 'var(--color-warning)';

    const session = sessions.get(currentSessionId);
    if (session) renderSessionList();

    const mobileHeader = document.getElementById('mobile-header');
    if (mobileHeader && window.innerWidth <= 768) {
        mobileHeader.style.display = 'flex';
    }

    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.classList.remove('active');

    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
        try {
            if (!engine) return;
            const expiredJson = engine.tick();
            const expired = JSON.parse(expiredJson);
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
        } catch (e) { /* ignore tick errors */ }
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
        const result = engine.encrypt_message(text, burnJson);
        const resultObj = JSON.parse(result);
        const payload = JSON.parse(resultObj.payload);

        if (connection && connection.isConnected) {
            connection.sendMessage(result);
        }

        addMessageToUI(payload, true, burnEnabled);
        input.value = '';

        const session = sessions.get(currentSessionId);
        session.messages.push({
            payload,
            fromSelf: true,
            isBurn: burnEnabled,
            decryptedContent: text,
            wire: resultObj.wire,
        });
        session.lastActivity = Date.now();

        if (!burnEnabled) {
            await storage.saveMessage(currentSessionId, {
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

function onMessageReceived(data) {
    if (handleProtocolMessage(data)) return;

    try {
        const msg = JSON.parse(data);
        const payload = JSON.parse(msg.payload);
        const isBurn = payload.burn != null;

        let displayContent;
        try {
            displayContent = engine.decrypt_message(msg.wire, msg.payload);
        } catch (e) {
            displayContent = payload.content || '[encrypted]';
        }

        const displayPayload = { ...payload, content: displayContent };
        addMessageToUI(displayPayload, false, isBurn);

        if (isBurn && payload.burn.mode === 'on_read') {
            engine.trigger_read(payload.id);
        }

        sendDeliveredReceipt(payload.id);
        showBrowserNotification('新消息', displayPayload.kind === 'file' ? '📎 文件' : displayContent.substring(0, 50));

        const session = sessions.get(currentSessionId);
        if (session) {
            session.messages.push({
                payload: displayPayload,
                fromSelf: false,
                isBurn,
                decryptedContent: displayContent,
                wire: msg.wire,
            });
            session.lastActivity = Date.now();
            session.unread++;
            renderSessionList();
        }

        if (!isBurn) {
            storage.saveMessage(currentSessionId, {
                id: payload.id,
                content: displayContent,
                fromSelf: false,
                timestamp: payload.ts,
                kind: payload.kind || 'text',
            });
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

    const session = sessions.get(currentSessionId);
    if (session) {
        session.peerName = session.peerName === '新连接' || session.peerName === '已连接'
            ? '对方' : session.peerName;
        renderSessionList();
    }

    showToast('加密连接已建立', 'success');
}

function onDisconnected() {
    const status = document.getElementById('connection-status');
    status.textContent = '离线';
    status.style.background = 'var(--color-destructive-dim)';
    status.style.color = 'var(--color-destructive)';
    showToast('连接已断开', 'warning');
    renderSessionList();
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

    if (connection) connection.close();
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

const RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;

class SimpleP2P {
    constructor(rtcConfig, onMessage, onConnect, onDisconnect) {
        if (!RTC) {
            throw new Error('WebRTC 不可用，请使用现代浏览器并确保通过 HTTPS 访问');
        }

        this.onMessage = onMessage;
        this.onConnect = onConnect;
        this.onDisconnect = onDisconnect;
        this.isConnected = false;
        this.pc = null;
        this.channel = null;

        this.pc = new RTC(rtcConfig);

        this.pc.oniceconnectionstatechange = () => {
            if (this.pc.iceConnectionState === 'connected') {
                this.isConnected = true;
                this.onConnect();
            } else if (this.pc.iceConnectionState === 'disconnected' || this.pc.iceConnectionState === 'failed') {
                this.isConnected = false;
                this.onDisconnect();
            }
        };
    }

    async createOffer() {
        this.channel = this.pc.createDataChannel('sealedchat');
        this.setupChannel(this.channel);

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        const candidates = await this.gatherICECandidates();
        return { sdp: this.pc.localDescription.sdp, candidates };
    }

    async createAnswer(offerSdp, offerCandidates) {
        await this.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });

        for (const c of offerCandidates) {
            await this.pc.addIceCandidate(new RTCIceCandidate({
                candidate: c.candidate,
                sdpMid: c.sdpMid,
                sdpMLineIndex: c.sdpMLineIndex,
            }));
        }

        this.pc.ondatachannel = (e) => { this.setupChannel(e.channel); };

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);

        const candidates = await this.gatherICECandidates();
        return { sdp: this.pc.localDescription.sdp, candidates };
    }

    async acceptAnswer(answerSdp, answerCandidates) {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

        for (const c of answerCandidates) {
            await this.pc.addIceCandidate(new RTCIceCandidate({
                candidate: c.candidate,
                sdpMid: c.sdpMid,
                sdpMLineIndex: c.sdpMLineIndex,
            }));
        }
    }

    gatherICECandidates(timeoutMs = 10000) {
        return new Promise((resolve) => {
            const candidates = [];
            let settled = false;

            const done = () => {
                if (settled) return;
                settled = true;
                resolve(candidates);
            };

            this.pc.onicecandidate = (event) => {
                if (event.candidate) {
                    candidates.push({
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex,
                    });
                }
            };

            this.pc.onicegatheringstatechange = () => {
                if (this.pc.iceGatheringState === 'complete') done();
            };

            setTimeout(done, timeoutMs);

            if (this.pc.iceGatheringState === 'complete') done();
        });
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

    close() {
        if (this.channel) this.channel.close();
        if (this.pc) this.pc.close();
    }
}

// ── File Transfer ──
function setupFileTransfer() {
    const btnFile = document.getElementById('btn-file');
    const fileInput = document.getElementById('file-input');

    if (btnFile && fileInput) {
        btnFile.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleFileSelect);
    }
}

async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
        showToast('文件大小不能超过 10MB', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
        const arrayBuffer = reader.result;
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

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
            const result = engine.encrypt_message(base64, burnJson);
            const resultObj = JSON.parse(result);
            const payload = JSON.parse(resultObj.payload);
            payload.kind = 'file';
            payload.filename = file.name;
            payload.mime_type = file.type;
            payload.size = file.size;

            const sendObj = { ...resultObj, payload: JSON.stringify(payload) };

            if (connection && connection.isConnected) {
                connection.sendMessage(JSON.stringify(sendObj));
            }

            addMessageToUI(payload, true, burnEnabled);
            e.target.value = '';

            const session = sessions.get(currentSessionId);
            if (session) {
                session.messages.push({ payload, fromSelf: true, isBurn: burnEnabled });
                session.lastActivity = Date.now();
            }
        } catch (err) {
            showToast('文件发送失败: ' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

// ── Typing Indicator ──
let typingTimeout = null;
let lastTypingSent = 0;

function setupTypingIndicator() {
    const input = document.getElementById('msg-input');
    if (!input) return;

    input.addEventListener('input', () => {
        const now = Date.now();
        if (now - lastTypingSent > 2000 && connection && connection.isConnected) {
            connection.sendMessage(JSON.stringify({ type: 'typing', isTyping: true }));
            lastTypingSent = now;
        }

        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if (connection && connection.isConnected) {
                connection.sendMessage(JSON.stringify({ type: 'typing', isTyping: false }));
            }
        }, 3000);
    });
}

function showTypingIndicator(show) {
    const el = document.getElementById('typing-indicator');
    if (el) el.style.display = show ? 'block' : 'none';
}

// ── Read Receipts ──
function sendReadReceipt(msgId) {
    if (connection && connection.isConnected) {
        connection.sendMessage(JSON.stringify({ type: 'receipt', msgId, status: 'read' }));
    }
}

function sendDeliveredReceipt(msgId) {
    if (connection && connection.isConnected) {
        connection.sendMessage(JSON.stringify({ type: 'receipt', msgId, status: 'delivered' }));
    }
}

// ── Browser Notifications ──
function setupNotifications() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function showBrowserNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        new Notification(title, { body, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🔒</text></svg>' });
    }
}

// ── Handle Protocol Messages ──
function handleProtocolMessage(data) {
    try {
        const msg = JSON.parse(data);

        if (msg.type === 'typing') {
            showTypingIndicator(msg.isTyping);
            return true;
        }

        if (msg.type === 'receipt') {
            if (msg.status === 'read') {
                const el = document.querySelector(`[data-msg-id="${msg.msgId}"] .msg-status`);
                if (el) {
                    el.textContent = '✓✓';
                    el.style.color = 'var(--color-primary-light)';
                }
            }
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

main().catch(console.error);
