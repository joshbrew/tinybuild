self.onmessage = (event) => {
  const { buffer } = event.data;
  const pixels = new Uint8ClampedArray(buffer);
  pixels.fill(128);
  self.postMessage(buffer, [buffer]);
};
