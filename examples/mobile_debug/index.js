import { createHotContext } from "tinybuild/client/hot";
const hot = createHotContext("mobile-debug");
let count = hot.data.count || 0;
const output = document.querySelector("output");
const button = document.createElement("button");
button.textContent = "Increment";
document.querySelector("main").append(button);
const render = () => (output.textContent = "Mobile debug count: " + count);
button.onclick = () => {
  count++;
  render();
};
hot.dispose((data) => {
  data.count = count;
  button.remove();
});
render();
