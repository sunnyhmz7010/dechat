import { base62Encode, base62Decode } from './encoding.js';

export class RoomManager {
    constructor(engine, rtcConfig) {
        this.engine = engine;
        this.rtcConfig = rtcConfig;
        this.roomId = null;
        this.isHost = false;
        this.peers = new Map();
        this.connections = new Map();
        this.messageHistory = [];
        this.onPeerJoined = null;
        this.onPeerLeft = null;
        this.onMessage = null;
        this.onRoomCode = null;
        this.onHistoryReceived = null;
    }

    async createRoom() {
        this.isHost = true;
        this.roomId = this.generateRoomId();
        
        const conn = new SimpleP2P(this.rtcConfig, 
            (data) => this.handleMessage(data, 'host'),
            () => this.handleConnect('host'),
            () => this.handleDisconnect('host')
        );
        
        const { sdp, candidates } = await conn.createOffer();
        const offerJson = this.engine.create_offer(sdp, JSON.stringify(candidates));
        
        const roomData = {
            v: 1,
            type: 'room',
            id: this.roomId,
            offer: offerJson
        };
        
        const compressed = pako.gzip(JSON.stringify(roomData));
        const roomCode = base62Encode(compressed);
        
        this.connections.set('host', conn);
        
        return {
            roomId: this.roomId,
            roomCode: roomCode,
            connection: conn
        };
    }

    async joinRoom(roomCode) {
        try {
            const compressed = base62Decode(roomCode);
            const roomDataStr = pako.ungzip(compressed, { to: 'string' });
            const roomData = JSON.parse(roomDataStr);
            
            if (roomData.v !== 1 || roomData.type !== 'room') {
                throw new Error('无效的房间码');
            }
            
            this.roomId = roomData.id;
            this.isHost = false;
            
            const offerJson = roomData.offer;
            const offer = JSON.parse(offerJson);
            const offerSdp = atob(offer.webrtc.sdp);
            const offerCandidates = offer.webrtc.candidates;
            
            const conn = new SimpleP2P(this.rtcConfig,
                (data) => this.handleMessage(data, 'host'),
                () => this.handleConnect('host'),
                () => this.handleDisconnect('host')
            );
            
            const { sdp, candidates } = await conn.createAnswer(offerSdp, offerCandidates);
            const answerJson = this.engine.create_answer(offerJson, sdp, JSON.stringify(candidates));
            
            this.connections.set('host', conn);
            
            return {
                roomId: this.roomId,
                answerJson: answerJson,
                connection: conn
            };
        } catch (e) {
            throw new Error('房间码无效: ' + e.message);
        }
    }

    addPeer(peerId, conn) {
        this.peers.set(peerId, {
            id: peerId,
            connection: conn,
            joinedAt: Date.now()
        });
        
        if (this.onPeerJoined) {
            this.onPeerJoined(peerId);
        }
    }

    removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.connection.close();
            this.peers.delete(peerId);
            
            if (this.onPeerLeft) {
                this.onPeerLeft(peerId);
            }
        }
    }

    broadcastMessage(message) {
        const messageStr = JSON.stringify(message);
        
        this.connections.forEach((conn, peerId) => {
            if (conn.isConnected) {
                conn.sendMessage(messageStr);
            }
        });
        
        this.peers.forEach((peer, peerId) => {
            if (peer.connection.isConnected) {
                peer.connection.sendMessage(messageStr);
            }
        });
    }

    sendToPeer(peerId, message) {
        const conn = this.connections.get(peerId);
        if (conn && conn.isConnected) {
            conn.sendMessage(JSON.stringify(message));
        }
        
        const peer = this.peers.get(peerId);
        if (peer && peer.connection.isConnected) {
            peer.connection.sendMessage(JSON.stringify(message));
        }
    }

    handleMessage(data, peerId) {
        try {
            const msg = JSON.parse(data);
            
            if (msg.type === 'history_request') {
                this.handleHistoryRequest(peerId);
                return;
            }
            
            if (msg.type === 'history_response') {
                this.handleHistoryResponse(msg.messages);
                return;
            }
            
            if (msg.type === 'message') {
                this.messageHistory.push(msg.payload);
                if (this.messageHistory.length > 100) {
                    this.messageHistory.shift();
                }
            }
            
            if (this.onMessage) {
                this.onMessage(msg, peerId);
            }
        } catch (e) {
            console.error('Handle message error:', e);
        }
    }

    handleHistoryRequest(peerId) {
        const recentMessages = this.messageHistory.slice(-50);
        this.sendToPeer(peerId, {
            type: 'history_response',
            messages: recentMessages
        });
    }

    handleHistoryResponse(messages) {
        if (messages && messages.length > 0) {
            this.messageHistory = [...messages, ...this.messageHistory];
            if (this.messageHistory.length > 100) {
                this.messageHistory = this.messageHistory.slice(-100);
            }
            if (this.onHistoryReceived) {
                this.onHistoryReceived(messages);
            }
        }
    }

    requestHistory() {
        this.broadcastMessage({
            type: 'history_request'
        });
    }

    addToHistory(payload) {
        this.messageHistory.push(payload);
        if (this.messageHistory.length > 100) {
            this.messageHistory.shift();
        }
    }

    handleConnect(peerId) {
        console.log('Peer connected:', peerId);
        if (this.onPeerJoined) {
            this.onPeerJoined(peerId);
        }
    }

    handleDisconnect(peerId) {
        console.log('Peer disconnected:', peerId);
        this.removePeer(peerId);
    }

    generateRoomId() {
        return Math.random().toString(36).substring(2, 10);
    }

    getRoomInfo() {
        return {
            roomId: this.roomId,
            isHost: this.isHost,
            peerCount: this.peers.size + this.connections.size
        };
    }

    destroy() {
        this.connections.forEach(conn => conn.close());
        this.peers.forEach(peer => peer.connection.close());
        this.connections.clear();
        this.peers.clear();
        this.roomId = null;
    }
}

class SimpleP2P {
    constructor(rtcConfig, onMessage, onConnect, onDisconnect) {
        const RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        if (!RTC) {
            throw new Error('WebRTC 不可用');
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
