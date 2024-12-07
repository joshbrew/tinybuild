onmessage = function (e) {
    const { buffer, start, end } = e.data;
    const pixelArray = new Uint8ClampedArray(buffer);

    // Generate random pixel colors for the assigned range
    for (let i = start; i < end; i++) {
        const offset = (i - start) * 4; // Offset relative to this worker's buffer
        pixelArray[offset] = Math.random() * 255; // Red
        pixelArray[offset + 1] = Math.random() * 255; // Green
        pixelArray[offset + 2] = Math.random() * 255; // Blue
        pixelArray[offset + 3] = 255; // Alpha (fully opaque)
    }

    // Transfer the buffer back to the main thread
    postMessage(pixelArray.buffer, [pixelArray.buffer]);
};
