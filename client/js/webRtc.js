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
  let userinfo;
  const peers = {};

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
    const Constraints = { audio: true, video: true };

    try {
      localStream = await navigator.mediaDevices.getUserMedia(Constraints);
      localVideo.name = localStream.id;
      localVideo.srcObject = localStream;
      websocket.sendMessage({ type: SEND_TYPE.WEB_RTC_OPENED });
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
    if (!localStream && !userinfo) return;
    switch (resp.type) {
      // 接收 WebRtc Offer, 傳送 answer(ots)
      // 其他人須設置 offer
      // @TODO: 取得使用者資訊和 offer，回圈 peers 去設置 remoteDesc(answer)
      case SEND_TYPE.WEB_RTC_RECEIVE_OFFER: {
        // step1: 判斷是否已經建立連接
        if (peers[resp.data.id]) break;
        // step2: 建立 peer 連線
        const peer = await createRtcConnect();
        // step3: set remote description(offer)
        let isSuccess = await handleRemoteDescription(peer, resp.data.offer);
        // step4: create answer -> send answer and setLocalDesc(answer); 
        isSuccess &= await handleSendAnswer(peer, resp.data.id);
        // step5: save user and peer instance as key-value pair
        isSuccess && (peers[resp.data.id] = peer);
        log("RECEIVE OFFER DONE", resp.data.offer);
        break;
      };
      // 接收 WebRtc Answer(ots)
      // 自己設置 offer
      // @TODO: 取得 使用者資訊和 answer，回圈 peers 去設置 remoteDesc(answer)
      case SEND_TYPE.WEB_RTC_RECEIVE_ANSWER: {
        // step1: 判斷是否已經建立連接
        if (peers[resp.data.id]) break;
        // step2: 建立 peer 連線(取出自己已開啟的 peer 又或者 建立一個新的 peer)
        const peer = peers[userinfo.id] || await createRtcConnect();
        // step1: Receive answer -> setRemoteDesc(answer)
        await handleRemoteDescription(resp.data.answer);
        log("RECEIVE_ANSWER", resp.data.answer);
        break;
      };
      // 接收 WebRtc candidate，並加入到 WebRtc candidate 候選人中(ots)
      case SEND_TYPE.WEB_RTC_RECEIVE_CANDIDATE: {
        await handleAppendNewCandidate(resp.data.candidate);
        log("RECEIVE_CANDIDATE", resp.data.candidate);
        break;
      };
      // 開啟 webRtc 是否被允許
      case SEND_TYPE.WEB_RTC_OPENED: {
        // @TODO_IMPORTANT: 一個 offer 對應一個 answer 還是 一個 offer 通吃全部 answer, 如果是前者，那就要改成跑loop建立 多個offer去發送，取回多個 answer 去對應各個 offer
        if (resp.data.code === 200) {
          const peer = await createRtcConnect();
          peers[userinfo.id] = peer;
          await handleSendOffer(peer);
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

  // 建立 P2P 連線
  async function createRtcConnect() {
    if (!localStream) return console.warn('media was not opened yet');
    const pc = new RTCPeerConnection({ iceServers });
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
        type: SEND_TYPE.WEB_RTC_SEND_CANDIDATE,
        payload: { candidate: evt.candidate }
      });
    });

    // @TODO: track event or stream event;
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

    return pc;
  };

  // 建立 offer
  async function handleSendOffer(peer) {
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      log("創建 offer", offer);
      websocket.sendMessage({ type: SEND_TYPE.WEB_RTC_SEND_OFFER, payload: { offer } });
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
  async function handleAppendNewCandidate(candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
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
  };
})();
