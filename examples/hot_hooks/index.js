import { createHotContext } from "tinybuild/client/hot";
const hot = createHotContext("counter");
let count = hot.data.count || 0;
const button = document.querySelector("button");
const render = () => {
  document.querySelector("output").textContent = "Count: " + count;
};
const increment = () => {
  count++;
  render();
};
button.addEventListener("click", increment);
hot.dispose((data) => {
  data.count = count;
  button.removeEventListener("click", increment);
});
hot.accept(() => render());
render();
