const button = document.querySelector("button"),
  input = document.querySelector("input"),
  output = document.querySelector("output");
async function calculate() {
  button.disabled = true;
  try {
    const value = Number(input.value);
    const reply = await globalThis.__TAURI__.core.invoke("calculate", {
      value,
    });
    output.textContent = `${value} × ${value} = ${reply.result} (backend PID ${reply.pid})`;
    output.dataset.pid = reply.pid;
    output.dataset.result = reply.result;
  } catch (error) {
    output.textContent = String(error);
  } finally {
    button.disabled = false;
  }
}
if (globalThis.__TAURI__) {
  button.onclick = calculate;
  calculate();
} else {
  button.disabled = true;
  output.textContent =
    "Run npm run native:dev to use the bundled backend. A browser preview has no native process.";
}
