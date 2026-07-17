// Choices made in the pre-join lobby, threaded into the call so it starts with
// the right devices and mute/camera state. Both tracks are always acquired;
// "off" is expressed as track.enabled=false (never a missing track) so the
// WebRTC renegotiation path is never forced.
export type JoinSettings = {
  audioDeviceId?: string;
  videoDeviceId?: string;
  initialAudioOn: boolean;
  initialVideoOn: boolean;
};
