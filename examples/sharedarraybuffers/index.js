import './index.css'

const resX = 10000; const resY = 10000;

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
canvas.width = resX; canvas.height = resY;
const ctx = canvas.getContext("2d");

const canvas2 = document.createElement("canvas");
document.body.appendChild(canvas2);
canvas2.width = resX; canvas2.height = resY;
const ctx2 = canvas2.getContext("2d");

// Create a container for results table
const resultsDiv = document.createElement("div");
document.body.appendChild(resultsDiv);

const width = canvas.width;
const height = canvas.height;
const totalPixels = width * height;

const workerCount = navigator.hardwareConcurrency || 4;
const pixelsPerWorker = Math.floor(totalPixels / workerCount);
// Create a SharedArrayBuffer for pixel data
const sharedBuffer = new SharedArrayBuffer(totalPixels * 4); // Each pixel: 4 bytes (RGBA)
const sharedPixelArray = new Uint8ClampedArray(sharedBuffer); // View for RGBA pixel data

let startSharedTime, endSharedTime;

const sharedWorkers = [];
let completedSharedWorkers = 0;

// Create shared buffer workers
for (let i = 0; i < workerCount; i++) {
    const worker = new Worker("worker.js");
    sharedWorkers.push(worker);
}

// Wait for shared workers to finish
sharedWorkers.forEach((worker) => {
    worker.onmessage = () => {
        completedSharedWorkers++;
        if (completedSharedWorkers === workerCount) {
            endSharedTime = performance.now();

            console.log(
                `SharedArrayBuffer Workers completed in ${endSharedTime - startSharedTime}ms`
            );

            // Render the canvas
            const nonSharedArray = new Uint8ClampedArray(sharedPixelArray);
            const imageData = new ImageData(nonSharedArray, width, height);
            ctx.putImageData(imageData, 0, 0);

            // Add the shared buffer timing result to the table
            updateResultsTable(endSharedTime - startSharedTime, null);

            // Start the second phase after rendering
            startNonSharedWorker();
        }
    };
});

// Delay the start for accurate timing
setTimeout(() => {
    // Create shared buffer workers
    for (let i = 0; i < workerCount; i++) {
        // Assign work range
        const start = i * pixelsPerWorker;
        startSharedTime = performance.now();
        const end = i === workerCount - 1 ? totalPixels : (i + 1) * pixelsPerWorker;
        const worker = sharedWorkers[i];
        worker.postMessage({ sharedBuffer, start, end });
    }
}, 1000);

function startNonSharedWorker() {

    const nonSharedBuffers = Array(workerCount)
        .fill(null)
        .map(() => new Uint8ClampedArray(pixelsPerWorker * 4)); // Create one buffer per worker

    let completedNonSharedWorkers = 0;
    let startNonSharedTime, endNonSharedTime;

    console.log("Starting Non-SharedArrayBuffer Workers...");

    const workers = [];
    for (let i = 0; i < workerCount; i++) {
        const worker = new Worker("nonsharedworker.js");
        workers.push(worker);

        // Assign work range
        const start = i * pixelsPerWorker;
        const end = i === workerCount - 1 ? totalPixels : (i + 1) * pixelsPerWorker;

        const buffer = nonSharedBuffers[i];

        worker.postMessage(
            { buffer, start, end }, // Send the buffer and range
            [buffer.buffer] // Transfer the buffer
        );

        worker.onmessage = (e) => {
            // Reconstruct the buffer from the worker's result
            nonSharedBuffers[i] = new Uint8ClampedArray(e.data);

            completedNonSharedWorkers++;

            if (completedNonSharedWorkers === workerCount) {
                endNonSharedTime = performance.now();

                console.log(
                    `Non-SharedArrayBuffer Workers completed in ${
                        endNonSharedTime - startNonSharedTime
                    }ms`
                );

                // Merge all buffers into one
                const mergedBuffer = new Uint8ClampedArray(totalPixels * 4);
                nonSharedBuffers.forEach((buffer, index) => {
                    mergedBuffer.set(buffer, index * pixelsPerWorker * 4);
                });

                // Render the canvas with the merged buffer
                const imageData = new ImageData(mergedBuffer, width, height);
                ctx2.putImageData(imageData, 0, 0);

                // Add the non-shared buffer timing result to the table
                updateResultsTable(null, endNonSharedTime - startNonSharedTime);
            }
        };
    }

    startNonSharedTime = performance.now();
}




function updateResultsTable(sharedTime, nonSharedTime) {
    if (!resultsDiv.innerHTML) {
        // Create table if it doesn't exist
        const table = document.createElement("table");
        table.setAttribute("border", "1");
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Method</th>
                    <th>Time (ms)</th>
                </tr>
            </thead>
            <tbody id="resultsBody">
            </tbody>
        `;
        resultsDiv.appendChild(table);
    }

    const resultsBody = document.getElementById("resultsBody");
    if (sharedTime !== null) {
        const row = `<tr><td>SharedArrayBuffer</td><td>${sharedTime.toFixed(2)}</td></tr>`;
        resultsBody.innerHTML += row;
    }

    if (nonSharedTime !== null) {
        const row = `<tr><td>Non-SharedArrayBuffer</td><td>${nonSharedTime.toFixed(2)}</td></tr>`;
        resultsBody.innerHTML += row;
    }
}