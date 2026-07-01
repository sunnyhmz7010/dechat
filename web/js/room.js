import { base62Encode, base62Decode } from './encoding.js';

export class RoomManager {
    constructor(engine, rtcConfig) {
        this.engine = engine;
        this.rtcConfig = rtcConfig;
        this.roomId = null;
        this.isHost = false;
        this.peers = new Map();
        this.onPeerJoined = null;
        this.onPeerLeft = null;
        this.onMessage = null;
    }

    async createRoom() {
        this.isHost = true;
        this.roomId = this.generateRoomId();
        
        const conn = new SimpleP2P(this.rtcConfig, 
            (data) => this.handleMessage(data),
            () => this.handleConnect(),
            () => this.handleDisconnect()
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
                (data) => this.handleMessage(data),
                () => this.handleConnect(),
                () => this.handleDisconnect()
            );
            
            const { sdp, candidates } = await conn.createAnswer(offerSdp, offerCandidates);
            const answerJson = this.engine.create_answer(offerJson, sdp, JSON.stringify(candidates));
            
            return {
                roomId: this.roomId,
                answerJson: answerJson,
                connection: conn
            };
        } catch (e) {
            throw new Error('房间码无效: ' + e.message);
        }
    }

    generateRoomId() {
        return Math.random().toString(36).substring(2, 10);
    }

    handleMessage(data) {
        try {
            const msg = JSON.parse(data);
            if (this.onMessage) {
                this.onMessage(msg);
            }
        } catch (e) {
            console.error('Handle message error:', e);
        }
    }

    handleConnect() {
        console.log('Peer connected');
        if (this.onPeerJoined) {
            this.onPeerJoined();
        }
    }

    handleDisconnect() {
        console.log('Peer disconnected');
        if (this.onPeerLeft) {
            this.onPeerLeft();
        }
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
