// Start your app here. Imports are built automatically.
import "./index.css";

document.body.style.backgroundColor = "#101010";
document.body.style.color = "white";

const square = document.createElement("div");
square.id = "floatingDiv";
square.textContent = "Hello World!";
document.body.append(square);

// A small animation to show that the page is running.
let x = 0;
let y = 0;
let dx = 2;
let dy = 2;

function animate() {
  x += dx;
  y += dy;
  if (x <= 0 || x + square.offsetWidth >= window.innerWidth) dx *= -1;
  if (y <= 0 || y + square.offsetHeight >= window.innerHeight) dy *= -1;
  square.style.left = x + "px";
  square.style.top = y + "px";
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
