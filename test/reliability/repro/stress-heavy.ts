import { runConcurrencyRepro } from "./concurrency-repro.ts";
const r = await runConcurrencyRepro({ writers: 24, writesPerWriter: 200 });
console.log(JSON.stringify({ writers: r.writers, perWriter: r.writesPerWriter, totalAttempted: r.totalAttempted, totalWritten: r.totalWritten, lockedErrors: r.lockedErrors, otherErrors: r.otherErrors, chainValid: r.chainValid }));
if (!r.chainValid || r.lockedErrors > 0 || r.totalWritten !== r.totalAttempted) process.exit(1);
