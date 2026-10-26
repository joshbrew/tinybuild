onmessage = ({ data }: MessageEvent<number>) => postMessage(data * 2);
