export class Custom extends HTMLElement {
  connectedCallback() {
    this.textContent = "Native custom elements need no framework dependency.";
  }
}
customElements.define("custom-demo", Custom);
