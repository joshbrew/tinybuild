const socket = new WebSocket(
  location.origin.replace(/^http/, "ws") + "/socket/echo",
  "tinybuild-demo",
);
socket.onopen = () => socket.send("Echo through WebSocket proxy");
socket.onmessage = (event) =>
  (document.querySelector("output").textContent = event.data);
socket.onerror = () =>
  (document.querySelector("output").textContent = "Start backend.js first");
addEventListener("beforeunload", () => socket.close(), { once: true });
