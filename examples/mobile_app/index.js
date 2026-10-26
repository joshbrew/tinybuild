const output = document.createElement("p");
output.textContent =
  "This same web app runs in a browser or a Capacitor shell.";
document.body.append(output);
const button = document.createElement("button");
button.textContent = "Get location";
button.onclick = () =>
  navigator.geolocation?.getCurrentPosition(
    (position) => {
      output.textContent =
        position.coords.latitude + ", " + position.coords.longitude;
    },
    (error) => {
      output.textContent = error.message;
    },
  );
document.body.append(button);
