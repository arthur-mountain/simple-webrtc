'use strict';

export default (() => {
  const localVideo = document.querySelector('#localVideo');
  const remoteVideo = document.querySelector('#remoteVideo');
  const CHANNEL_TYPE = { SIMPLE: 'simple-channel', FILE: 'file-channel' };
  let pc;
  let webSocket;
  let SEND_TYPE;
  let localStream;
  let dataChannel, fileChannel;

  function init({ ws }, MESSAGE_TYPE) {
    webSocket = ws;
    SEND_TYPE = MESSAGE_TYPE;
    initPeerConnection();
  };

  // 取得視訊與語音資訊
  async function handleOpenUserMedia() {
    console.log('handleOpenUserMedia pc =>', pc);
    const Constraints = { audio: true, video: true };

    try {
      localStream = await navigator.mediaDevices.getUserMedia(Constraints);
      localVideo.srcObject = localStream;
      localStream.getTracks().forEach(track => {
        // console.log(`mediaTrack =>`, track);
        pc.addTrack(track, localStream);
      })
      createDataChannel();

      // // 取得裝置名稱
      // const video = localStream.getVideoTracks();
      // const audio = localStream.getAudioTracks();

      // if (video.length > 0) console.log(`使用影像裝置 => ${video[0].label}`)
      // if (audio.length > 0) console.log(`使用聲音裝置 => ${audio[0].label}`)
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

    // 監聽 ICE Server(找尋到 ICE 候選位置後，透過 WebSocket Server 與另一位配對)
    pc.onicecandidate = async (evt) => {
      if (!evt.candidate) return;
      console.log('onIceCandidate => ', evt);
      // Send candidate to websocket server
      webSocket.sendMessage({
        type: SEND_TYPE.SEND_CANDIDATE,
        payload: { candidate: evt.candidate }
      });
    };

    // 監聽 ICE 連接狀態
    pc.oniceconnectionstatechange = (evt) => {
      console.log('ICE 伺服器狀態變更 => ', evt);
      if (evt.target.iceGatheringState === 'complete') pc.close()
    };

    // 接收 track 傳入
    pc.ontrack = (evt) => {
      if (remoteVideo.srcObject) return;

      console.log(`Ontrack evt =>`, evt);
      remoteVideo.srcObject = evt.streams[0];
    };

    // 每當 WebRtc 進行會話連線時，在addTrack後會觸發該事件，通常會在此處理 createOffer，來通知remote peer與我們連線
    pc.onnegotiationneeded = async () => {
      try {
        await handleSendOffer();
      } catch (err) {
        console.log(`Onnegotiationneeded error =>`, err);
      }
    };

    // 接收 data channel 資訊
    pc.ondatachannel = (evt) => {
      console.log(`Ondatachannel ~ evt =>`, evt);
      const channel = evt.channel;

      if (channel.label === CHANNEL_TYPE.SIMPLE) {
        channel.onmessage = cEvt => {
          console.log("Received simple data channel => ", cEvt)
        };
      }

      if (channel.label === CHANNEL_TYPE.FILE) {
        channel.onmessage = cEvt => {
          console.log("Received file data channel => ", cEvt)
        };
      }

      // channel.onopen = (evt) => {
      //   console.log(`data channel opened`, evt);
      // };
      // channel.onclose = (evt) => {
      //   console.log(`data channel closed`, evt);
      // };
    };
  }

  // 建立 localVideo offer, 設置 localDescription(本地流配置)
  async function handleSendOffer() {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log("Local description offer => ", offer);

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
    console.log("Local description answer => ", answer);

    // 傳送 answer to Others
    webSocket.sendMessage({
      type: SEND_TYPE.SEND_ANSWER,
      payload: { answer }
    })
  }

  // 創建 data channel
  async function createDataChannel() {
    if (!pc) return console.log('尚未開啟連接!!!');

    // 建立 data channel 傳遞資訊
    dataChannel = pc.createDataChannel(CHANNEL_TYPE.SIMPLE);
    fileChannel = pc.createDataChannel(CHANNEL_TYPE.FILE);
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

  // Data channel 傳送 data
  async function handleSendData(data) {
    if (!pc) return console.log('尚未開啟連接!!!');
    if (!datachannel) return console.log('尚未建立data-channel連接!!!');

    datachannel.send(JSON.stringify(data));
  }

  return {
    init,
    handleOpenUserMedia,
    handleSendOffer,
    handleSendAnswer,
    handleSendData,
    handleRemoteDescription,
    handleAppendNewCandidate,
  };
})();
