// Must be imported before any @solana/* module. ES imports are hoisted and
// evaluated in source order, so keeping this in its own module (imported
// first) guarantees these globals exist before web3.js/spl-token evaluate.
import { Buffer } from 'buffer'

if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer
if (typeof globalThis.global === 'undefined') globalThis.global = globalThis
if (typeof globalThis.process === 'undefined') globalThis.process = { env: {} }
