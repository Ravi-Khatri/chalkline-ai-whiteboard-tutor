// Runs the on-device language model (WebLLM) off the main thread, so the page
// stays responsive while the model downloads and generates.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
