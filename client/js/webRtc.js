'use strict';

export default (() => {
  const videoContainer = document.querySelector("#videoContainer");
  const localVideo = videoContainer.querySelector('#localVideo');
  let pc;
  let webSocket;
  let SEND_TYPE;
  let localStream;

  function init({ ws }, MESSAGE_TYPE) {
    webSocket = ws;
    SEND_TYPE = MESSAGE_TYPE;
    initPeerConnection();
  };

  // 取得視訊與語音資訊
  async function handleOpenUserMedia() {
    const Constraints = { audio: true, video: true };

    try {
      localStream = await navigator.mediaDevices.getUserMedia(Constraints);
      localVideo.name = localStream.id;
      localVideo.srcObject = localStream;
      localStream.getTracks().forEach(track => {
        // console.log(`mediaTrack =>`, track);
        pc.addTrack(track, localStream);
      })
    } catch (error) {
      console.error('Open User Media error:\n', error)
    }
  }

  // 建立 P2P 連線
  function initPeerConnection() {
    pc = new RTCPeerConnection({
      iceServers: [{
        urls: 'stun:stun.l.google.com:19302' // Google's public STUN server
      }]
    });

    // 監聽 ICE 連接狀態
    pc.oniceconnectionstatechange = (evt) => {
      log("ICE 伺服器狀態變更", evt);
      if (['failed;', 'closed'].includes(evt.target.iceGatheringState)) {
        pc.close();
      }
    };

    // 監聽 ICE Server(找尋到 ICE 候選位置後，透過 WebSocket Server 與另一位配對)
    pc.onicecandidate = async (evt) => {
      if (!evt.candidate) return;
      log("發現新 icecandidate", evt);
      // Send candidate to websocket server
      webSocket.sendMessage({
        type: SEND_TYPE.SEND_CANDIDATE,
        payload: { candidate: evt.candidate }
      });
    };

    // 接收 track 傳入
    pc.ontrack = (evt) => {
      const fragment = document.createDocumentFragment();
      evt.streams.forEach(stream => {
        if (videoContainer.children.namedItem(stream.id)) return;
        const remoteVideo = document.createElement("video");
        remoteVideo.setAttribute("name", stream.id);
        remoteVideo.setAttribute("width", "100%");
        remoteVideo.setAttribute("autoplay", true);
        remoteVideo.setAttribute("playsinline", true);
        remoteVideo.srcObject = stream;
        fragment.appendChild(remoteVideo);
      });
      videoContainer.appendChild(fragment);
      log("接收 track", evt);
    };

    // 每當 WebRtc 進行會話連線時，在addTrack後會觸發該事件，通常會在此處理 createOffer，來通知remote peer與我們連線
    pc.onnegotiationneeded = async () => {
      try {
        await handleSendOffer();
      } catch (err) {
        console.error(`Onnegotiationneeded error =>`, err);
      }
    };
  }

  // 建立 localVideo offer, 設置 localDescription(本地流配置)
  async function handleSendOffer() {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log("創建 offer", offer);

    // 傳送 localVideo offer to others
    webSocket.sendMessage({
      type: SEND_TYPE.SEND_OFFER,
      payload: { offer }
    })
  }

  // 建立 answer
  async function handleSendAnswer() {
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    log("創建 answer", answer);

    // 傳送 answer to Others
    webSocket.sendMessage({
      type: SEND_TYPE.SEND_ANSWER,
      payload: { answer }
    })
  }

  // 新增 ice candidate 候選人
  async function handleAppendNewCandidate(candidate) {
    pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  // 設置 remote description
  async function handleRemoteDescription(desc) {
    if (!pc) return console.log('尚未開啟連接!!!');

    await pc.setRemoteDescription(desc);
  }

  return {
    init,
    handleOpenUserMedia,
    handleSendOffer,
    handleSendAnswer,
    handleRemoteDescription,
    handleAppendNewCandidate,
  };
})();
