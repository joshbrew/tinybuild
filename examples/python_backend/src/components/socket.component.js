export class Socket extends HTMLElement {
  connectedCallback() {
    this.innerHTML =
      "<button>Connect WebSocket</button><pre>Disconnected</pre>";
    this.querySelector("button").onclick = () => {
      this.ws?.close();
      this.ws = new WebSocket(
        (location.protocol === "https:" ? "wss://" : "ws://") +
          location.hostname +
          ":7000/",
      );
      this.ws.onmessage = (event) => {
        this.querySelector("pre").textContent = event.data;
      };
      this.ws.onerror = () => {
        this.querySelector("pre").textContent =
          "Start the Python server on port 7000";
      };
    };
  }
  disconnectedCallback() {
    this.ws?.close();
  }
}
customElements.define("socket-test", Socket);
