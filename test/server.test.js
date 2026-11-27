const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { until } = require('./fakeGame');

test('a failed network-config refresh is logged and retried, the API keeps running', async (t) => {
    const root = path.join(__dirname, '..');
    const server = spawn(process.execPath, ['-r', path.join(__dirname, 'serverPreload.js'), 'server.js'], {
        cwd: root,
        env: { ...process.env, PORT: '0', USERNAME: 'user', PASSWORD: 'secret' },
    });
    t.after(() => server.kill('SIGKILL'));
    let output = '';
    let exitCode = null;
    server.stdout.on('data', (data) => { output += data; });
    server.stderr.on('data', (data) => { output += data; });
    server.on('exit', (code) => { exitCode = code ?? -1; });
    const failures = () => output.split('### network config not refreshed: fetch failed ###').length - 1;
    await until(() => failures() >= 2 || exitCode !== null, 10000);
    assert.equal(exitCode, null, `the API exited:\n${output.slice(-2000)}`);
    assert.ok(failures() >= 2, 'the next tick tried again');
});
