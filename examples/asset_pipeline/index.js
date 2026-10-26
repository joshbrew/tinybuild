import "./style.css";
import icon from "./icon.svg";
document.body.innerHTML =
  '<h1>Lazy modules and imported assets</h1><img alt="Example icon" src="' +
  icon +
  '"><button>Load a module</button><output></output>';
document.querySelector("button").onclick = async () => {
  const { message } = await import("./lazy.js");
  document.querySelector("output").textContent = message;
};
