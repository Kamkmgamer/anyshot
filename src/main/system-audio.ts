/** Computer audio comes from Electron's loopback capture, which only Windows provides. */
export const SYSTEM_AUDIO_AVAILABLE = process.platform === 'win32';
