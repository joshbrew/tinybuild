import { double } from "./shared.js";
import text from "./message.txt";
self.onmessage = (event) =>
  self.postMessage(double(event.data) + " " + text.trim());
