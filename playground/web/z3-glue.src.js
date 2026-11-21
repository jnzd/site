// Bundled with esbuild into z3-glue.js: z3-solver's browser entry, which
// expects z3-built.js (the Emscripten module) to have defined initZ3.
import { init } from 'z3-solver/build/browser.js';
window.z3Init = init;
