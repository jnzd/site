// Runs Z3 (z3-solver, Wasm) in a worker thread and answers queries through
// shared memory, so that Lex can wait for the answer synchronously.
import { parentPort, workerData } from 'node:worker_threads';
import { init } from 'z3-solver';

const flag = new Int32Array(workerData.sab);
const { Z3 } = await init();
const cfg = Z3.mk_config();
const ctx = Z3.mk_context(cfg);
parentPort.postMessage('ready');
parentPort.on('message', async (script) => {
  let code = 3;
  try {
    const out = await Z3.eval_smtlib2_string(ctx, '(reset)\n' + script);
    const last = out.trim().split('\n').pop().trim();
    code = last === 'sat' ? 1 : last === 'unsat' ? 2 : 3;
    if (code === 3) console.error('z3 said:', out);
  } catch (e) { console.error('z3 error:', e); }
  Atomics.store(flag, 0, code);
  Atomics.notify(flag, 0);
});
