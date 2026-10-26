const render = () => {
  document.querySelector("main").textContent =
    "Client route: " + location.pathname;
};
document.querySelector("a").onclick = (event) => {
  event.preventDefault();
  history.pushState({}, "", "/dashboard/settings");
  render();
};
addEventListener("popstate", render);
render();
