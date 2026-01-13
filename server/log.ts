export function logTs(...args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.sss
  console.log(`[${ts}]`, ...args);
}
