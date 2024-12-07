onmessage = function (e) {
    const { sharedBuffer, start, end } = e.data;
    const pixelArray = new Uint8ClampedArray(sharedBuffer); // View for RGBA pixel data

    // Generate random pixel colors for the assigned range
    for (let i = start; i < end; i++) {
        const offset = i * 4; // Each pixel has 4 components (R, G, B, A)
        pixelArray[offset] = Math.random() * 255;     // Red
        pixelArray[offset + 1] = Math.random() * 255; // Green
        pixelArray[offset + 2] = Math.random() * 255; // Blue
        pixelArray[offset + 3] = 255;                 // Alpha (fully opaque)
    }

    // Notify the main thread that this worker is done
    postMessage("done");
};
