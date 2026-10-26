fetch("dist/static/settings.json")
  .then((response) => response.json())
  .then(
    (settings) =>
      (document.querySelector("output").textContent = settings.message),
  );
