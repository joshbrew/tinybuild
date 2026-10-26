import { serveWorker, transferResult } from "tinybuild/client/workers";
serveWorker({
  double(buffer) {
    const values = new Uint8Array(buffer);
    for (let i = 0; i < values.length; i++) values[i] *= 2;
    return transferResult(buffer, [buffer]);
  },
  async slow() {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    return 42;
  },
});
