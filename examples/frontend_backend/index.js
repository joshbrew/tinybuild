const output = document.createElement("pre");
document.body.append(output);
fetch("/api/hello/tinybuild")
  .then((response) => response.json())
  .then((data) => {
    output.textContent = data.message;
  })
  .catch((error) => {
    output.textContent = error.message;
  });
