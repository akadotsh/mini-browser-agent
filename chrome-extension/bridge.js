const socketUrl = "ws://127.0.0.1:18765/bridge";
let socket;
let retryMs = 500;

function connect() {
  if (socket && socket.readyState < WebSocket.CLOSING) return;
  socket = new WebSocket(socketUrl);
  socket.onopen = () => {
    retryMs = 500;
    localStorage.setItem("bridge-connected", "true");
    socket.send(JSON.stringify({ type: "hello" }));
  };
  socket.onmessage = async event => {
    const request = JSON.parse(event.data);
    if (request.type === "event") return;
    try {
      const response = await chrome.runtime.sendMessage({ target: "background", type: "request", request });
      socket.send(JSON.stringify(response));
    } catch (error) {
      socket.send(JSON.stringify({ id: request.id, error: String(error?.message || error) }));
    }
  };
  socket.onclose = () => {
    localStorage.setItem("bridge-connected", "false");
    socket = undefined;
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 5000);
  };
  socket.onerror = () => socket.close();
}

chrome.runtime.onMessage.addListener(message => {
  if (message.target === "bridge" && socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message.data));
});

connect();
