import { double } from "./shared.js";
self.onmessage = (event) => self.postMessage(double(event.data));
