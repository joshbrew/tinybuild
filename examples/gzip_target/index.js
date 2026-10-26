import "./style.css";
document.body.innerHTML = `<h1>Smaller downloads with gzip</h1>
<p>The server can send this page compressed. Your browser unpacks it automatically.</p>
<p>Open the Network tab in developer tools and inspect the page response for Content-Encoding: gzip.</p>
<button>Try the app</button><output>Count: 0</output>`;
let count = 0;
document.querySelector("button").onclick = () => {
  document.querySelector("output").textContent = `Count: ${++count}`;
};
