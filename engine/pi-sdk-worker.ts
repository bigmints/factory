import { readFileSync, writeFileSync } from 'node:fs';
import {
    runPiSessionViaSdk,
    runPiVerificationViaSdk,
    type CliSessionOptions,
    type CliSessionResult,
    type PiVerificationOptions,
    type PiVerificationResult,
} from './cli-session.ts';

interface WorkerInput {
    mode?: 'build' | 'verify';
    options?: CliSessionOptions;
    verificationOptions?: PiVerificationOptions;
    resultPath: string;
}

async function main() {
    const inputPath = process.argv[2];
    if (!inputPath) {
        throw new Error('Usage: pi-sdk-worker <input.json>');
    }

    const input = JSON.parse(readFileSync(inputPath, 'utf-8')) as WorkerInput;
    const result = input.mode === 'verify'
        ? await runPiVerificationViaSdk(input.verificationOptions!)
        : await runPiSessionViaSdk(input.options!);
    writeResult(input.resultPath, result);
    process.exit(result.status === 'delivered' || result.status === 'verified' ? 0 : 1);
}

function writeResult(path: string, result: CliSessionResult | PiVerificationResult) {
    writeFileSync(path, JSON.stringify(result), 'utf-8');
}

main().catch((err: any) => {
    const inputPath = process.argv[2];
    if (inputPath) {
        try {
            const input = JSON.parse(readFileSync(inputPath, 'utf-8')) as WorkerInput;
            writeResult(input.resultPath, {
                status: 'failed',
                exitCode: 1,
                output: `Pi SDK worker failed: ${err.message}`,
                files: [],
            });
        } catch {
            // Nothing else to do; parent will report worker stderr/exit.
        }
    }
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
});
