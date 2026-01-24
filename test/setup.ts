import { afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GlobalWindow } from "happy-dom";

const window = new GlobalWindow();
window.document.write("<!doctype html><html><body></body></html>");
globalThis.window = window as any;
globalThis.document = window.document as any;
globalThis.navigator = window.navigator as any;

for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globalThis)) {
    (globalThis as any)[key] = (window as any)[key];
  }
}

afterEach(() => {
  cleanup();
});
