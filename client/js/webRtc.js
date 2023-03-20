'use strict';

// 目前只建立一個 peer connect, 因此只能一對一
export default (() => {
  const videoContainer = document.querySelector("#videoContainer");
  const iceServers = [{
    urls: 'stun:stun.l.google.com:19302' // Google's public STUN server
  }];
  let websocket;
  let SEND_TYPE;
  let localStream;
  let userinfo;
  let peers = {};

  function init({ ws }, MESSAGE_TYPE) {
    websocket = ws;
    SEND_TYPE = MESSAGE_TYPE;
  };

  function setUserInfo(info) {
    userinfo = info;
  }

  // 取得視訊與語音資訊
  async function handleOpenUserMedia() {
    if (localStream) return console.warn('media was already opened');
    const localVideo = document.createElement('video');
    const Constraints = { audio: true, video: true };

    try {
      localStream = await navigator.mediaDevices.getUserMedia(Constraints);
      localVideo.name = localStream.id;
      localVideo.srcObject = localStream;
      videoContainer.prepend(localVideo);
      websocket.sendMessage({ type: SEND_TYPE.WEB_RTC_OPENED });
    } catch (error) {
      console.error('Open User Media error:\n', error)
    }
  };

  async function handleWebRtcMessage(resp) {
    if (!localStream && !userinfo) return;
    switch (resp.type) {
      // 接收 WebRtc Offer,其他人須設置 offer, 傳送 answer(ots)
      case SEND_TYPE.WEB_RTC_RECEIVE_OFFER: {
        // step1: 判斷是否已經建立連接
        if (peers[resp.data.id] && peers[resp.data.id].remoteDescription) break;
        // step2: 建立 peer 連線
        const peer = peers[resp.data.id] || await createRtcConnect(resp.data.id);
        // step3: set remote description(offer)
        let isSuccess = await handleRemoteDescription(peer, resp.data.offer);
        // step4: create answer -> send answer and setLocalDesc(answer); 
        isSuccess &= await handleSendAnswer(peer, resp.data.id);
        // step5: save user and peer instance as key-value pair
        isSuccess && (peers[resp.data.id] = peer);
        log("RECEIVE OFFER DONE", resp.data.offer);
        break;
      };
      // 接收 WebRtc Answer, 自己設置 offer
      case SEND_TYPE.WEB_RTC_RECEIVE_ANSWER: {
        // step1: 判斷是否已經建立連接
        if (peers[resp.data.id] && peers[resp.data.id].remoteDescription) break;
        await handleRemoteDescription(peers[resp.data.id], resp.data.answer);
        log("RECEIVE_ANSWER", resp.data.answer);
        break;
      };
      // 接收 WebRtc candidate，並加入到 WebRtc candidate 候選人中(ots)
      case SEND_TYPE.WEB_RTC_RECEIVE_CANDIDATE: {
        Object.values(peers).forEach(async (peer) => {
          await handleAppendNewCandidate(peer, resp.data.candidate);
        })
        log("RECEIVE_CANDIDATE", resp.data.candidate);
        break;
      };
      // 開啟 webRtc 是否被允許
      case SEND_TYPE.WEB_RTC_OPENED: {
        if (resp.code === 200) {
          const ids = resp.data.clientIds;
          if (ids.length) {
            ids.forEach(async (id) => {
              const peer = await createRtcConnect(id);
              peers[id] = peer;
              await handleSendOffer(peer, id);
            })
          }
        } else {
          log("WEB_RTC_OPENED_FAILED", "admin don't allow you to connect webRtc");
        }
        break;
      };
      default: {
        console.error("UnHandle webRtc sub type", resp)
      }
    }
  };

  function handleWebRtcDeleteById(id) {
    if (!localStream) return console.warn('media was not opened yet');
    if (peers[id]) delete peers[id];

    if (videoContainer.children.namedItem(id)) videoContainer.children.namedItem(id).remove();
  }

  function handleWebRtcCleanUp() {
    if (!localStream) return console.warn('media was not opened yet');
    peers = {};
    Array.from(videoContainer.children).forEach(v => v.remove());
  }

  // 建立 P2P 連線
  async function createRtcConnect(id) {
    if (!localStream) return console.warn('media was not opened yet');
    const pc = new RTCPeerConnection({ iceServers });
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream)
    });

    // 監聽 ICE 連接狀態
    pc.addEventListener("iceconnectionstatechange", (evt) => {
      log("ICE 伺服器狀態變更", evt);
      // 此 peer connect 已經連接完畢，將其關閉
      if (evt.target.iceGatheringState === "complete") pc.close();
    });

    // 監聽 ICE Server(找尋到 ICE 候選位置後，透過 websocket Server 與另一位配對)
    pc.addEventListener("icecandidate", (evt) => {
      if (!evt.candidate) return;
      log("發現新 icecandidate", evt);
      // Send candidate to websocket server
      websocket.sendMessage({
        type: SEND_TYPE.WEB_RTC_SEND_CANDIDATE,
        payload: { candidate: evt.candidate }
      });
    });

    // @TODO: track event or stream event;
    // 接收 track 傳入
    pc.addEventListener("track", (evt) => {
      if (evt.streams && evt.streams[0]) {
        const stream = evt.streams[0];
        if (!stream.active) return console.warn("stream is not active");

        if (videoContainer.children.namedItem(id)) {
          const item = videoContainer.children.namedItem(id);
          if (item.srcObject !== stream) item.srcObject = stream;
          return;
        }
        const remoteVideo = document.createElement("video");
        remoteVideo.setAttribute("name", id);
        remoteVideo.setAttribute("width", "100%");
        remoteVideo.setAttribute("autoplay", true);
        remoteVideo.setAttribute("playsinline", true);
        remoteVideo.srcObject = stream;
        videoContainer.appendChild(remoteVideo);

        stream.oninactive = (evt) => {
          log("track inactive", evt);
          const item = videoContainer.children.namedItem(id);

          if (item && item.srcObject === evt.target) {
            const p = document.createElement("p");
            p.textContent = `user connect failed`;
            item.replaceWith(p);
            setTimeout(() => p.remove(), 3000);
          }
        }
      } else {
        const stream = new MediaStream();
        videoElem.srcObject = stream;
        stream.addTrack(evt.track);
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

    return pc;
  };

  // 建立 offer
  async function handleSendOffer(peer, to) {
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      log("創建 offer", offer);
      websocket.sendMessage({
        type: SEND_TYPE.WEB_RTC_SEND_OFFER, payload: { to, offer }
      });
      return 1;
    } catch (error) {
      log("WEB RTC CREATE AND REPLY OFFER FAILED", error);
    }
    return 0;
  };
  // 建立 answer
  async function handleSendAnswer(peer, to) {
    try {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      log("創建 answer", answer);
      websocket.sendMessage({
        type: SEND_TYPE.WEB_RTC_SEND_ANSWER, payload: { to, answer }
      });
      return 1;
    } catch (error) {
      log("WEB RTC CREATE AND REPLY ANSWER FAILED", error);
    }
    return 0;
  };
  // 新增 ice candidate 候選人
  async function handleAppendNewCandidate(peer, candidate) {
    await peer.addIceCandidate(new RTCIceCandidate(candidate));
  };
  // 設置 remote description
  async function handleRemoteDescription(peer, desc) {
    try {
      await peer.setRemoteDescription(desc);
      return 1;
    } catch (error) {
      log("WEB_RTC_RECEIVE_OFFER", "set remote offer failed", error);
    }
    return 0;
  };

  return {
    init,
    setUserInfo,
    handleOpenUserMedia,
    handleCloseUserMedia,
    handleWebRtcMessage,
    handleWebRtcDeleteById,
    handleWebRtcCleanUp,
  };
})();
