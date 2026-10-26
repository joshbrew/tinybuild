self.onmessage = (event) => {
  const { sharedBuffer, start, end } = event.data;
  const pixels = new Uint8ClampedArray(sharedBuffer);
  for (let index = start * 4; index < end * 4; index++)
    pixels[index] = index % 256;
  self.postMessage("done");
};
