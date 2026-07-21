'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../index');

function fakeApp(config = {}) {
    const calls = [];

    return {
        calls,
        hooks: {},
        logger: { error() {} },
        config: {
            url: 'https://logs.example.com/api',
            token: 'secret-token',
            app: 'mailniaga-mta',
            flushInterval: 3600000,
            fetch: async (url, options) => {
                calls.push({ url, body: JSON.parse(options.body) });

                return { status: 202, ok: true, text: async () => '' };
            },
            ...config,
        },
        addHook(name, handler) {
            this.hooks[name] = handler;
        },
    };
}

function fireHook(app, name, ...args) {
    return new Promise(resolve => app.hooks[name](...args, resolve));
}

test('init registers the default delivery hooks', async () => {
    const app = fakeApp();

    await new Promise(resolve => plugin.init(app, resolve));

    assert.deepEqual(
        Object.keys(app.hooks).sort(),
        ['message:queue', 'queue:bounce', 'sender:delivered', 'sender:responseError'],
    );

    await app.logCentral.close();
});

test('init without credentials disables the plugin instead of throwing', async () => {
    const app = fakeApp({ token: undefined });

    await new Promise(resolve => plugin.init(app, resolve));

    assert.deepEqual(app.hooks, {});
    assert.equal(app.logCentral, undefined);
});

test('delivery lifecycle hooks ship log entries with the zonemta channel', async () => {
    const app = fakeApp();

    await new Promise(resolve => plugin.init(app, resolve));

    await fireHook(app, 'message:queue', { id: 'msg1', from: 'a@b.my', to: ['c@d.my'], interface: 'feeder' }, { subject: 'Hello' });
    await fireHook(app, 'sender:delivered', { id: 'msg1', seq: '001', recipient: 'c@d.my', domain: 'd.my', sendingZone: 'default' }, { response: '250 OK' });
    await fireHook(app, 'sender:responseError', { id: 'msg2', seq: '002', recipient: 'x@y.my' }, null, { response: '451 try later', category: 'defer' });
    await fireHook(app, 'queue:bounce', { id: 'msg3', seq: '003', to: 'z@q.my', response: '550 no such user', category: 'blacklist' });

    await app.logCentral.close();

    assert.equal(app.calls.length, 1);

    const entries = app.calls[0].body;

    assert.equal(entries.length, 4);
    assert.ok(entries.every(entry => entry.channel === 'zonemta'));
    assert.ok(entries.every(entry => entry.app === 'mailniaga-mta'));

    assert.deepEqual(entries.map(entry => entry.level), ['info', 'info', 'warning', 'error']);
    assert.match(entries[0].message, /Queued msg1 from a@b\.my to 1 recipient/);
    assert.match(entries[1].message, /Delivered msg1\.001 to c@d\.my/);
    assert.match(entries[2].message, /Delivery failed for msg2\.002 to x@y\.my: 451 try later/);
    assert.match(entries[3].message, /Bounced msg3\.003 to z@q\.my: 550 no such user/);

    assert.equal(JSON.parse(entries[1].context).response, '250 OK');
    assert.equal(JSON.parse(entries[3].context).category, 'blacklist');
});

test('events config toggles hooks, including the raw log:entry feed', async () => {
    const app = fakeApp({ events: { delivered: false, raw: true } });

    await new Promise(resolve => plugin.init(app, resolve));

    assert.equal(app.hooks['sender:delivered'], undefined);
    assert.ok(app.hooks['log:entry']);

    await fireHook(app, 'log:entry', { id: 'msg9', action: 'QUEUED', zone: 'default' });
    await app.logCentral.close();

    const entry = app.calls[0].body[0];

    assert.equal(entry.level, 'debug');
    assert.equal(entry.message, 'QUEUED');
    assert.equal(JSON.parse(entry.context).id, 'msg9');
});

test('a throwing handler still calls next and never breaks mail flow', async () => {
    const app = fakeApp();

    await new Promise(resolve => plugin.init(app, resolve));

    let advanced = false;
    app.hooks['message:queue'](null, null, () => {
        advanced = true;
    });

    assert.equal(advanced, true);

    await app.logCentral.close();
});
