fetch("/api/message")
  .then((response) => response.json())
  .then(({ message }) => {
    document.querySelector("output").textContent = message;
  })
  .catch(() => {
    document.querySelector("output").textContent =
      "Start npm start to run the supervised backend.";
  });
