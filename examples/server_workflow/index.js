document.body.innerHTML = `<main><h1>A painless server workflow</h1>
<p>Use the same config for development, building, and serving production output.</p>
<output>Checking the server...</output><p><button>Check readiness</button></p>
<a href="/demo/settings">Try a deep link</a><pre></pre></main>`;
const output = document.querySelector("output");
const details = document.querySelector("pre");
async function check() {
  try {
    const response = await fetch("/_tinybuild/ready");
    const state = await response.json();
    const message = await (await fetch("/api/message")).json();
    output.textContent = state.ready
      ? "Server is ready"
      : "Server is not ready";
    details.textContent =
      message.message + "\nReadiness HTTP status: " + response.status;
  } catch (error) {
    output.textContent = error.message;
  }
}
document.querySelector("button").onclick = check;
check();
