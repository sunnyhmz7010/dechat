export class VideoManager {
    constructor(roomManager) {
        this.roomManager = roomManager;
        this.localStream = null;
        this.remoteStreams = new Map();
        this.isAudioEnabled = true;
        this.isVideoEnabled = true;
        this.isScreenSharing = false;
        this.onRemoteStream = null;
        this.onRemoteStreamRemoved = null;
    }

    async startLocalStream() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            return this.localStream;
        } catch (e) {
            console.error('Failed to get local stream:', e);
            throw e;
        }
    }

    async startScreenShare() {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false
            });
            
            const videoTrack = screenStream.getVideoTracks()[0];
            this.replaceVideoTrack(videoTrack);
            
            videoTrack.onended = () => {
                this.stopScreenShare();
            };
            
            this.isScreenSharing = true;
            return screenStream;
        } catch (e) {
            console.error('Failed to start screen share:', e);
            throw e;
        }
    }

    stopScreenShare() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.stop();
            }
        }
        this.isScreenSharing = false;
    }

    replaceVideoTrack(newTrack) {
        if (this.localStream) {
            const oldTrack = this.localStream.getVideoTracks()[0];
            if (oldTrack) {
                this.localStream.removeTrack(oldTrack);
                oldTrack.stop();
            }
            this.localStream.addTrack(newTrack);
        }
    }

    toggleAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isAudioEnabled = audioTrack.enabled;
            }
        }
        return this.isAudioEnabled;
    }

    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.isVideoEnabled = videoTrack.enabled;
            }
        }
        return this.isVideoEnabled;
    }

    stopLocalStream() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
    }

    addRemoteStream(peerId, stream) {
        this.remoteStreams.set(peerId, stream);
        if (this.onRemoteStream) {
            this.onRemoteStream(peerId, stream);
        }
    }

    removeRemoteStream(peerId) {
        this.remoteStreams.delete(peerId);
        if (this.onRemoteStreamRemoved) {
            this.onRemoteStreamRemoved(peerId);
        }
    }

    getRemoteStreams() {
        return this.remoteStreams;
    }

    destroy() {
        this.stopLocalStream();
        this.remoteStreams.clear();
    }
}
