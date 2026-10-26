let count = 0;
document.querySelector("button").onclick = () => {
  count++;
  render();
};
function render() {
  document.querySelector("output").textContent = "Desktop count: " + count;
}
render();
