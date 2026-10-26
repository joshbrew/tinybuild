fetch("/api/hello")
  .then((response) => response.json())
  .then((data) => {
    document.querySelector("output").textContent = data.message;
  })
  .catch((error) => {
    document.querySelector("output").textContent =
      "Start backend.js: " + error.message;
  });
