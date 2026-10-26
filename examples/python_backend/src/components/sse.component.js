export class SSE extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<button>Connect SSE</button><pre>Disconnected</pre>";
    this.querySelector("button").onclick = () => {
      this.events?.close();
      this.events = new EventSource(
        location.protocol + "//" + location.hostname + ":7000/sse",
      );
      this.events.onmessage = (event) => {
        this.querySelector("pre").textContent = event.data;
      };
      this.events.onerror = () => {
        this.querySelector("pre").textContent =
          "Start Python with CORS for http://localhost:8080, or serve this page from Python on port 7000";
      };
    };
  }
  disconnectedCallback() {
    this.events?.close();
  }
}
customElements.define("sse-test", SSE);
