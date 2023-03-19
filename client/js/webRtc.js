'use strict';

// 目前只建立一個 peer connect, 因此只能一對一
// @TODO: 一對多，除了自己外，其他個別建立 peer connect
export default (() => {
  const videoContainer = document.querySelector("#videoContainer");
  const localVideo = videoContainer.querySelector('#localVideo');
  const iceServers = [{
    urls: 'stun:stun.l.google.com:19302' // Google's public STUN server
  }];
  let pc;
  let websocket;
  let SEND_TYPE;
  let localStream;
  const peers = {};

  function init({ ws }, MESSAGE_TYPE) {
    websocket = ws;
    SEND_TYPE = MESSAGE_TYPE;
  };

  // 取得視訊與語音資訊
  async function handleOpenUserMedia() {
    if (localStream) return console.warn('media was already opened');
    const Constraints = { audio: true, video: true };

    try {
      localStream = await navigator.mediaDevices.getUserMedia(Constraints);
      localVideo.name = localStream.id;
      localVideo.srcObject = localStream;
      // @TODO: 這裡應該用 ROOM_USERS 事件，然後迴圈建立 peer 連線和發送 offer 給其他人
      await createRtcConnect();
      await handleSendOffer();
    } catch (error) {
      console.error('Open User Media error:\n', error)
    }
  };

  // 關閉視訊與語音資訊
  function handleCloseUserMedia() {
    if (!localStream) return console.warn('media was not opened yet');

    // @TODO: 關閉 peer instance and send message, remove all of video
  };

  async function handleWebRtcMessage(resp) {
    if (!localStream) return;
    switch (resp.data.subtype) {
      // 接收 WebRtc Offer, 傳送 answer(ots)
      // 其他人須設置 offer
      // @TODO: 取得 使用者資訊和 offer，回圈 peers 去設置 remoteDesc(answer)
      case SEND_TYPE.RECEIVE_OFFER: {
        // step1: Receive offer -> setRemoteDesc(offer)
        await handleRemoteDescription(resp.data.data.offer);
        // step2: Create answer -> send answer and setLocalDesc(answer); 
        await handleSendAnswer();
        log("RECEIVE_OFFER", resp.data.data.offer);
        break;
      };

      // 接收 WebRtc Answer(ots)
      // 自己設置 offer
      // @TODO: 取得 使用者資訊和 answer，回圈 peers 去設置 remoteDesc(answer)
      case SEND_TYPE.RECEIVE_ANSWER: {
        // step1: Receive answer -> setRemoteDesc(answer)
        await handleRemoteDescription(resp.data.data.answer);
        log("RECEIVE_ANSWER", resp.data.data.answer);
        break;
      };

      // 接收 WebRtc candidate，並加入到 WebRtc candidate 候選人中(ots)
      case SEND_TYPE.RECEIVE_CANDIDATE: {
        await handleAppendNewCandidate(resp.data.data.candidate);
        log("RECEIVE_CANDIDATE", resp.data.data.candidate);
        break;
      };

      default: {
        console.error("UnHandle webRtc sub type", resp)
      }
    }
  };

  // 建立 P2P 連線
  async function createRtcConnect() {
    if (!localStream) return console.warn('media was not opened yet');
    pc = new RTCPeerConnection({ iceServers });
    // localStream.getTracks().forEach(track => {
    //   pc.addTrack(track, localStream);
    // });
    pc.addStream(localStream);

    // 監聽 ICE 連接狀態
    pc.addEventListener("iceconnectionstatechange", (evt) => {
      log("ICE 伺服器狀態變更", evt);
      if (evt.target.iceGatheringState === "complete") {
        pc.close(); // 此 peer connect 已經連接完畢，將其關閉
      }
    });

    // 監聽 ICE Server(找尋到 ICE 候選位置後，透過 websocket Server 與另一位配對)
    pc.addEventListener("icecandidate", (evt) => {
      if (!evt.candidate) return;
      log("發現新 icecandidate", evt);
      // Send candidate to websocket server
      websocket.sendMessage({
        type: SEND_TYPE.SEND_CANDIDATE,
        payload: { candidate: evt.candidate }
      });
    });

    // 接收 track 傳入
    pc.addEventListener("track", (evt) => {
      const stream = evt.streams[0];
      if (!stream.active) return console.warn("stream is not active");

      if (videoContainer.children.namedItem(stream.id)) {
        const item = videoContainer.children.namedItem(stream.id);
        if (item.srcObject !== stream) item.srcObject = stream;
        return;
      }
      const remoteVideo = document.createElement("video");
      remoteVideo.setAttribute("name", stream.id);
      remoteVideo.setAttribute("width", "100%");
      remoteVideo.setAttribute("autoplay", true);
      remoteVideo.setAttribute("playsinline", true);
      remoteVideo.srcObject = stream;
      videoContainer.appendChild(remoteVideo);

      stream.oninactive = (evt) => {
        log("track inactive", evt);
        const item = videoContainer.children.namedItem(evt.target.id);

        if (item && item.srcObject === evt.target) {
          const div = document.createElement("div");
          div.textContent = `user connect failed`;
          item.replaceWith(div);
        }
      }
      log("接收 track", evt);
    });

    // // 每當 WebRtc 進行會話連線時，在addTrack後會觸發該事件，通常會在此處理 createOffer，來通知remote peer與我們連線
    // pc.addEventListener("negotiationneeded", (evt) => {
    //   try {
    //     log("send offer 通知 remote peer 與我們連線", evt);
    //     handleSendOffer();
    //   } catch (err) {
    //     console.error(`Onnegotiationneeded error =>`, err);
    //   }
    // });
  };

  // 建立 offer
  async function handleSendOffer() {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log("創建 offer", offer);
    websocket.sendMessage({ type: SEND_TYPE.SEND_OFFER, payload: { offer } });
  };
  // 建立 answer
  async function handleSendAnswer() {
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    log("創建 answer", answer);
    websocket.sendMessage({ type: SEND_TYPE.SEND_ANSWER, payload: { answer } });
  };
  // 新增 ice candidate 候選人
  async function handleAppendNewCandidate(candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  };
  // 設置 remote description
  async function handleRemoteDescription(desc) {
    await pc.setRemoteDescription(desc);
  };

  return {
    init,
    handleOpenUserMedia,
    handleCloseUserMedia,
    handleWebRtcMessage,
  };
})();
