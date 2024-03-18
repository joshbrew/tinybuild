/* 
    esbuild + nodejs development server. 
    Begin your javascript application here. This file serves as a simplified entry point to your app, 
    all other scripts you want to build can stem from here if you don't want to define more entryPoints 
    and an outdir in the bundler settings.

    Just ctrl-A + delete all this to get started on your app.

*/

import './index.css' //compiles with esbuild, just link the stylesheet in your index.html (the boilerplate shows this example)

document.body.style.backgroundColor = '#101010'; //page color
document.body.style.color = 'white'; //text color
let div = document.createElement('div');
div.innerHTML = 'Hello World!';
div.id = 'floatingDiv';
document.body.appendChild(div);

console.warn('Tinybuild successful!');

// Get the floating div element
var floatingDiv = document.getElementById("floatingDiv");

// Set initial position and velocity
var posX = 0;
var posY = 0;
var velX = 2;
var velY = 2;

// Update the position of the div and handle bouncing off the edges
function updatePosition() {
    posX += velX;
    posY += velY;

    // Check if the div has reached the left or right edge
    if (posX <= 0 || posX + floatingDiv.offsetWidth >= window.innerWidth) {
    velX *= -1; // Reverse the horizontal velocity
    }

    // Check if the div has reached the top or bottom edge
    if (posY <= 0 || posY + floatingDiv.offsetHeight >= window.innerHeight) {
    velY *= -1; // Reverse the vertical velocity
    }

    // Set the new position
    floatingDiv.style.left = posX + "px";
    floatingDiv.style.top = posY + "px";

    requestAnimationFrame(updatePosition);
}

// Call the updatePosition function repeatedly to animate the div
requestAnimationFrame(updatePosition);