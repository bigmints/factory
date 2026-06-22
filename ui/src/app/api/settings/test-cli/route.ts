import { NextResponse } from 'next/server';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function POST(request: Request) {
    try {
        const { cli } = await request.json();
        if (!cli) {
            return NextResponse.json({ ok: false, message: 'No CLI specified' });
        }

        const cmd = `${cli} --version`;
        try {
            const { stdout, stderr } = await execAsync(cmd, { env: process.env, timeout: 5000 });
            const output = (stdout || stderr || '').trim();
            if (!output) {
                return NextResponse.json({ ok: false, message: `${cli} ran but returned no output` });
            }
            return NextResponse.json({ ok: true, message: `CLI test passed: ${output.split('\n')[0]}` });
        } catch (err: any) {
            // Note: Since this will run inside a Next.js environment on mac or pi, we must make sure NVM/brew paths are known or use absolute if needed.
            // But we can just report the raw error.
            const msg = err.stderr ? err.stderr.trim() : err.message;
            return NextResponse.json({ ok: false, message: `CLI test failed: ${msg.split('\n')[0]}` });
        }

    } catch (err: any) {
        return NextResponse.json({ ok: false, message: err.message || 'Unexpected error' }, { status: 500 });
    }
}
