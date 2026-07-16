'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export type RoomChatMessage = {
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
};

type ServerToClientEvents = {
  'existing-peers': (peers: Array<{ peerId: string; displayName: string; avatarUrl: string | null; videoOn: boolean }>) => void;
  'peer-joined': (payload: { peerId: string; displayName: string; avatarUrl: string | null; videoOn: boolean }) => void;
  'peer-state-changed': (payload: { peerId: string; displayName: string; avatarUrl: string | null; videoOn: boolean }) => void;
  offer: (payload: { from: string; offer: RTCSessionDescriptionInit }) => void;
  answer: (payload: { from: string; answer: RTCSessionDescriptionInit }) => void;
  'ice-candidate': (payload: { from: string; candidate: RTCIceCandidateInit }) => void;
  'peer-left': (peerId: string) => void;
  'chat-message': (payload: RoomChatMessage) => void;
  'meeting-ended': (payload: { roomCode: string }) => void;
};

type ClientToServerEvents = {
  'join-room': (payload: { roomCode: string; displayName: string; videoOn: boolean }) => void;
  'media-state': (payload: { roomCode: string; videoOn: boolean }) => void;
  'join-room-chat': (payload: { roomCode: string }) => void;
  offer: (payload: { to: string; offer: RTCSessionDescriptionInit }) => void;
  answer: (payload: { to: string; answer: RTCSessionDescriptionInit }) => void;
  'ice-candidate': (payload: { to: string; candidate: RTCIceCandidateInit }) => void;
  'chat-message': (payload: { roomCode: string; text: string; senderName: string }) => void;
};

type PeerConnections = Map<string, RTCPeerConnection>;
type PeerPresence = {
  displayName: string;
  avatarUrl: string | null;
  videoOn: boolean;
};

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function getWsUrl() {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (!wsUrl) {
    throw new Error('NEXT_PUBLIC_WS_URL is required');
  }
  return wsUrl;
}

function addLocalTracksToPeer(connection: RTCPeerConnection, localStream: MediaStream | null) {
  if (!localStream) return;

  const existingTrackIds = new Set(
    connection
      .getSenders()
      .map((sender) => sender.track?.id)
      .filter((trackId): trackId is string => Boolean(trackId))
  );

  localStream.getTracks().forEach((track) => {
    if (!existingTrackIds.has(track.id)) {
      connection.addTrack(track, localStream);
    }
  });
}

function ensureReceiveOnlyTransceivers(connection: RTCPeerConnection) {
  const hasVideoTransceiver = connection.getTransceivers().some((transceiver) => transceiver.receiver.track?.kind === 'video');
  const hasAudioTransceiver = connection.getTransceivers().some((transceiver) => transceiver.receiver.track?.kind === 'audio');

  if (!hasVideoTransceiver) {
    connection.addTransceiver('video', { direction: 'recvonly' });
  }

  if (!hasAudioTransceiver) {
    connection.addTransceiver('audio', { direction: 'recvonly' });
  }
}

export default function useWebRTC(roomCode: string, localStream: MediaStream | null, localVideoOn: boolean) {
  const [peers, setPeers] = useState<Map<string, MediaStream>>(() => new Map());
  const [peerPresence, setPeerPresence] = useState<Map<string, PeerPresence>>(() => new Map());
  const [connectedPeerIds, setConnectedPeerIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const peerConnectionsRef = useRef<PeerConnections>(new Map());
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const localVideoOnRef = useRef(localVideoOn);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    localVideoOnRef.current = localVideoOn;
    const socket = socketRef.current;
    const roomInfo = { roomCode, videoOn: localVideoOn };
    if (socket?.connected) {
      socket.emit('media-state', roomInfo);
    }
  }, [localVideoOn, roomCode]);

  useEffect(() => {
    if (!roomCode || typeof window === 'undefined') {
      return;
    }

    const socket = io(getWsUrl());
    const displayName = window.localStorage.getItem('displayName') || window.localStorage.getItem('userName') || 'User';

    socketRef.current = socket;

    const cleanupPeer = (peerId: string) => {
      const connection = peerConnectionsRef.current.get(peerId);
      if (connection) {
        connection.onicecandidate = null;
        connection.ontrack = null;
        connection.close();
        peerConnectionsRef.current.delete(peerId);
      }

      setPeers((currentPeers) => {
        const nextPeers = new Map(currentPeers);
        nextPeers.delete(peerId);
        return nextPeers;
      });

      setConnectedPeerIds((currentPeerIds) => currentPeerIds.filter((id) => id !== peerId));

      setPeerPresence((currentPresence) => {
        const nextPresence = new Map(currentPresence);
        nextPresence.delete(peerId);
        return nextPresence;
      });
    };

    // Guards against sending overlapping offers to the same peer.
    const makingOffer = new Set<string>();

    const makeOffer = async (peerId: string) => {
      const connection = peerConnectionsRef.current.get(peerId);
      // Only offer from a stable state. If a negotiation is already in flight the
      // browser re-fires `negotiationneeded` once we return to stable, so bailing
      // here loses nothing.
      if (!connection || makingOffer.has(peerId) || connection.signalingState !== 'stable') {
        return;
      }

      try {
        makingOffer.add(peerId);
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        socket.emit('offer', { to: peerId, offer });
      } catch (error) {
        console.error('Failed to create offer', error);
      } finally {
        makingOffer.delete(peerId);
      }
    };

    // `isInitiator` is true only for the peer joining an existing call. That peer
    // drives (re)negotiation via `negotiationneeded`; the peer already in the room
    // only ever answers, so the two never glare. Renegotiation is what makes
    // late-arriving local media reach the peer — on mobile, getUserMedia often
    // resolves AFTER we've connected, so the first offer is receive-only and the
    // tracks must be re-offered once they exist, or our audio/video never sends.
    const ensureConnection = (peerId: string, isInitiator = false) => {
      const existingConnection = peerConnectionsRef.current.get(peerId);
      if (existingConnection) {
        addLocalTracksToPeer(existingConnection, localStreamRef.current);
        return existingConnection;
      }

      const connection = new RTCPeerConnection(rtcConfig);
      peerConnectionsRef.current.set(peerId, connection);

      connection.onicecandidate = (event) => {
        if (!event.candidate) return;

        socket.emit('ice-candidate', {
          to: peerId,
          candidate: event.candidate.toJSON(),
        });
      };

      connection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;

        setPeers((currentPeers) => {
          const nextPeers = new Map(currentPeers);
          nextPeers.set(peerId, remoteStream);
          return nextPeers;
        });
      };

      if (isInitiator) {
        connection.onnegotiationneeded = () => {
          void makeOffer(peerId);
        };
      }

      // Added after the handler above so the initial track/transceiver additions
      // trigger `negotiationneeded` and send the first offer.
      addLocalTracksToPeer(connection, localStreamRef.current);
      ensureReceiveOnlyTransceivers(connection);

      return connection;
    };

    const setPeerInfo = (peerId: string, info: PeerPresence) => {
      setPeerPresence((currentPresence) => {
        const nextPresence = new Map(currentPresence);
        nextPresence.set(peerId, info);
        return nextPresence;
      });
    };

    const handleExistingPeers = (peers: Array<{ peerId: string; displayName: string; avatarUrl: string | null; videoOn: boolean }>) => {
      setConnectedPeerIds(Array.from(new Set(peers.map((peer) => peer.peerId))));
      peers.forEach(({ peerId, displayName, avatarUrl, videoOn }) => {
        setPeerInfo(peerId, { displayName, avatarUrl, videoOn });
      });

      peers.forEach(({ peerId }) => {
        // Initiator: `negotiationneeded` fires from the track/transceiver setup
        // inside ensureConnection and sends the first offer.
        ensureConnection(peerId, true);
      });
    };

    const handlePeerJoined = ({ peerId, displayName, avatarUrl, videoOn }: { peerId: string; displayName: string; avatarUrl: string | null; videoOn: boolean }) => {
      setPeerInfo(peerId, { displayName, avatarUrl, videoOn });

      setConnectedPeerIds((currentPeerIds) =>
        currentPeerIds.includes(peerId) ? currentPeerIds : [...currentPeerIds, peerId]
      );
      ensureConnection(peerId);
    };

    const handlePeerStateChanged = ({ peerId, displayName, avatarUrl, videoOn }: { peerId: string; displayName: string; avatarUrl: string | null; videoOn: boolean }) => {
      setPeerInfo(peerId, { displayName, avatarUrl, videoOn });
    };

    const handleOffer = async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
      setConnectedPeerIds((currentPeerIds) =>
        currentPeerIds.includes(from) ? currentPeerIds : [...currentPeerIds, from]
      );

      const connection = ensureConnection(from);

      try {
        await connection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socket.emit('answer', { to: from, answer });
      } catch (error) {
        console.error('Failed to handle offer', error);
      }
    };

    const handleAnswer = async ({ from, answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
      setConnectedPeerIds((currentPeerIds) =>
        currentPeerIds.includes(from) ? currentPeerIds : [...currentPeerIds, from]
      );

      const connection = peerConnectionsRef.current.get(from);
      if (!connection) return;

      try {
        await connection.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error('Failed to handle answer', error);
      }
    };

    const handleIceCandidate = async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      const connection = peerConnectionsRef.current.get(from);
      if (!connection) return;

      try {
        await connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Failed to add ICE candidate', error);
      }
    };

    const handlePeerLeft = (peerId: string) => {
      cleanupPeer(peerId);
    };

    const handleChatMessage = (payload: RoomChatMessage) => {
      setMessages((currentMessages) => [...currentMessages, payload]);
    };

    const handleMeetingEnded = () => {
      setMeetingEnded(true);
    };

    const handleConnect = () => {
      socket.emit('join-room', {
        roomCode,
        displayName,
        videoOn: localVideoOnRef.current,
      });
      socket.emit('join-room-chat', { roomCode });
    };

    const handleConnectError = (error: Error) => {
      console.error('Socket connection error', error);
    };

    socket.on('connect', handleConnect);
    socket.on('existing-peers', handleExistingPeers);
    socket.on('peer-joined', handlePeerJoined);
    socket.on('peer-state-changed', handlePeerStateChanged);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('peer-left', handlePeerLeft);
    socket.on('chat-message', handleChatMessage);
    socket.on('meeting-ended', handleMeetingEnded);
    socket.on('connect_error', handleConnectError);

    if (socket.connected) {
      socket.emit('join-room', {
        roomCode,
        displayName,
        videoOn: localVideoOnRef.current,
      });
      socket.emit('join-room-chat', { roomCode });
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('existing-peers', handleExistingPeers);
      socket.off('peer-joined', handlePeerJoined);
      socket.off('peer-state-changed', handlePeerStateChanged);
      socket.off('offer', handleOffer);
      socket.off('answer', handleAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('peer-left', handlePeerLeft);
      socket.off('chat-message', handleChatMessage);
      socket.off('meeting-ended', handleMeetingEnded);
      socket.off('connect_error', handleConnectError);

      peerConnectionsRef.current.forEach((connection) => connection.close());
      peerConnectionsRef.current.clear();
      socket.disconnect();
      socketRef.current = null;

      setPeers(new Map());
      setConnectedPeerIds([]);
      setMessages([]);
    };
  }, [roomCode]);

  useEffect(() => {
    const currentStream = localStreamRef.current;
    if (!currentStream) return;

    peerConnectionsRef.current.forEach((connection) => {
      addLocalTracksToPeer(connection, currentStream);
    });
  }, [localStream]);

  const sendMessage = (text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const senderName =
      (typeof window !== 'undefined' &&
        (window.localStorage.getItem('displayName') ||
          window.localStorage.getItem('userName') ||
          window.localStorage.getItem('userEmail'))) ||
      'You';

    socketRef.current?.emit('chat-message', {
      roomCode,
      text: trimmedText,
      senderName,
    });

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        senderId: socketRef.current?.id ?? 'local',
        senderName,
        text: trimmedText,
        timestamp: Date.now(),
      },
    ]);
  };

  return { peers, peerPresence, connectedPeerIds, socketRef, messages, sendMessage, meetingEnded };
}
