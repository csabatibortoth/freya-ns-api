const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createProvider, checkProgram } = require('../services/certificateService/hookProvider');

const VALUE = 'A'.repeat(43);
const VALUE2 = 'B'.repeat(43);
const NAME = '_acme-challenge.example.com';
const unix = process.platform !== 'win32';

// A folder of our own (mode 700) with a script in it. `body` is the shell script.
function script(body, { mode = 0o755, name = 'hook.sh' } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freya hook '));
    fs.chmodSync(dir, 0o755);
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(file, mode);
    return { dir, file, log: path.join(dir, 'log.txt'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('the hook gets action, name and value as separate arguments and in ACME_* variables, and an empty environment otherwise', { skip: !unix }, async () => {
    process.env.FREYA_SECRET_FOR_TEST = 'database-password';
    const s = script(`{ echo "args:$#:$1:$2:$3"; echo "env:$ACME_ACTION:$ACME_NAME:$ACME_VALUE:$ACME_DOMAIN"; env | sort | cut -d= -f1 | tr '\\n' ' '; echo; echo "cwd:$(pwd)"; } > "$(dirname "$0")/log.txt"`);
    try {
        await createProvider({ program: s.file }).create(NAME, VALUE);
        const out = fs.readFileSync(s.log, 'utf8');
        assert.match(out, new RegExp(`args:3:create:${NAME}:${VALUE}`));
        assert.match(out, new RegExp(`env:create:${NAME}:${VALUE}:example.com`));
        assert.ok(!out.includes('FREYA_SECRET_FOR_TEST') && !out.includes('database-password'), 'the environment of the server must not reach the hook');
        const names = out.split('\n').find((line) => line.startsWith('ACME_') || line.includes('ACME_')).trim().split(/\s+/).filter((n) => !['PWD', 'SHLVL', '_', 'OLDPWD'].includes(n));
        assert.deepEqual(names.sort(), ['ACME_ACTION', 'ACME_DOMAIN', 'ACME_NAME', 'ACME_VALUE', 'PATH']);
        assert.ok(out.includes(`cwd:${fs.realpathSync(s.dir)}`));
        await createProvider({ program: s.file }).remove(NAME, VALUE);
        assert.match(fs.readFileSync(s.log, 'utf8'), /args:3:remove:/);
    } finally { delete process.env.FREYA_SECRET_FOR_TEST; s.cleanup(); }
});

test('there is no shell: a program path with spaces works, and nothing in the arguments is interpreted', { skip: !unix }, async () => {
    const s = script('echo "$1 $2" > "$(dirname "$0")/log.txt"');
    try {
        assert.ok(s.dir.includes(' '));
        await createProvider({ program: s.file }).create(NAME, VALUE);
        assert.equal(fs.readFileSync(s.log, 'utf8').trim(), `create ${NAME}`);
    } finally { s.cleanup(); }
});

test('names and values that could carry a command are refused before anything runs', { skip: !unix }, async () => {
    const s = script('echo ran > "$(dirname "$0")/log.txt"');
    try {
        const p = createProvider({ program: s.file });
        for (const bad of ['_acme-challenge.example.com; touch x', '_acme-challenge.$(id).example.com', '_acme-challenge.a b.example.com', '_acme-challenge.', 'example.com', '_acme-challenge.example.com\n', '_acme-challenge..example.com', '_acme-challenge.-x.example.com']) {
            await assert.rejects(p.create(bad, VALUE), /Only names/, bad);
        }
        for (const bad of ['short', `${VALUE}"; id`, `${VALUE.slice(1)}$`, 'A'.repeat(44)]) await assert.rejects(p.create(NAME, bad), /wrong form/, bad);
        assert.ok(!fs.existsSync(s.log), 'the hook must not have run');
    } finally { s.cleanup(); }
});

test('a failing hook is an error with the exit code and the last line of its error output, nothing else', { skip: !unix }, async () => {
    const s = script('echo "first line" >&2; printf "the registrar said no\\001\\n" >&2; exit 3');
    try {
        await assert.rejects(createProvider({ program: s.file }).create(NAME, VALUE), (err) => {
            assert.match(err.message, /failed with exit code 3/);
            assert.match(err.message, /the registrar said no/);
            assert.ok(!err.message.includes('first line'));
            assert.ok(!/[\u0000-\u001f]/.test(err.message));
            assert.ok(!err.message.includes(VALUE), 'the value is not repeated');
            return true;
        });
    } finally { s.cleanup(); }
});

test('a hook that does not finish is killed after the time limit; a hook that talks too much is stopped', { skip: !unix }, async () => {
    const slow = script('sleep 30');
    const loud = script('yes AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    try {
        const started = Date.now();
        await assert.rejects(createProvider({ program: slow.file, timeoutSeconds: 1 }).create(NAME, VALUE), /did not finish in 1 seconds and was stopped/);
        assert.ok(Date.now() - started < 5000);
        await assert.rejects(createProvider({ program: loud.file }).create(NAME, VALUE), /too much output|stopped|exit code/);
    } finally { slow.cleanup(); loud.cleanup(); }
});

test('calls run one at a time, in order, also after a failure', { skip: !unix }, async () => {
    const s = script('echo "start $1 $3" >> "$(dirname "$0")/log.txt"; sleep 0.3; echo "end $1 $3" >> "$(dirname "$0")/log.txt"; [ "$1" = remove ] && exit 1; exit 0');
    try {
        const p = createProvider({ program: s.file });
        const results = await Promise.allSettled([p.create(NAME, VALUE), p.create(NAME, VALUE2), p.remove(NAME, VALUE), p.remove(NAME, VALUE2)]);
        assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled', 'rejected', 'rejected']);
        const lines = fs.readFileSync(s.log, 'utf8').trim().split('\n').map((l) => l.split(' ').slice(0, 2).join(' '));
        assert.deepEqual(lines, ['start create', 'end create', 'start create', 'end create', 'start remove', 'end remove', 'start remove', 'end remove']);
    } finally { s.cleanup(); }
});

test('only a program that nobody else could have changed is accepted', { skip: !unix }, () => {
    const ok = script('exit 0');
    const writable = script('exit 0', { mode: 0o777 });
    const groupWritable = script('exit 0', { mode: 0o775 });
    const noExec = script('exit 0', { mode: 0o644 });
    const openDir = script('exit 0');
    fs.chmodSync(openDir.dir, 0o777);
    try {
        assert.doesNotThrow(() => createProvider({ program: ok.file }));
        assert.throws(() => createProvider({ program: writable.file }), /writable by group or others/);
        assert.throws(() => createProvider({ program: groupWritable.file }), /writable by group or others/);
        assert.throws(() => createProvider({ program: noExec.file }), /not executable/);
        assert.throws(() => createProvider({ program: openDir.file }), /writable by group or others/);
        assert.throws(() => createProvider({ program: ok.dir }), /regular file/);
        assert.throws(() => createProvider({ program: path.join(ok.dir, 'missing.sh') }), /does not exist/);
        assert.throws(() => createProvider({ program: 'hook.sh' }), /absolute path/);
        assert.throws(() => createProvider({ program: '' }), /needs a program/);
        assert.throws(() => createProvider({ program: ok.file, timeoutSeconds: 0 }), /FREYA_ACME_HOOK_TIMEOUT/);
        assert.throws(() => createProvider({ program: ok.file, timeoutSeconds: 301 }), /FREYA_ACME_HOOK_TIMEOUT/);
        assert.throws(() => checkProgram(ok.file, { uid: 99999, fsApi: { ...fs, statSync: (p) => { const stat = fs.statSync(p); return new Proxy(stat, { get: (t, k) => (k === 'uid' ? 4242 : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) }); }, realpathSync: fs.realpathSync, accessSync: fs.accessSync } }), /belongs to another user/);
    } finally { [ok, writable, groupWritable, noExec, openDir].forEach((s) => { fs.chmodSync(s.dir, 0o755); s.cleanup(); }); }
});

test('the program is checked again at every call: a file that was changed after the start is not run', { skip: !unix }, async () => {
    const s = script('echo ran > "$(dirname "$0")/log.txt"');
    try {
        const p = createProvider({ program: s.file });
        fs.chmodSync(s.file, 0o777);
        await assert.rejects(p.create(NAME, VALUE), /writable by group or others/);
        assert.ok(!fs.existsSync(s.log));
    } finally { s.cleanup(); }
});

test('a program that cannot be started is reported without the arguments', { skip: !unix }, async () => {
    const s = script('exit 0');
    fs.writeFileSync(s.file, 'not a script, no interpreter line\n');
    try {
        await assert.rejects(createProvider({ program: s.file }).create(NAME, VALUE), (err) => { assert.match(err.message, /could not be started|exit code/); assert.ok(!err.message.includes(VALUE)); return true; });
    } finally { s.cleanup(); }
});
