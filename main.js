/**
 *
 * opensesame adapter
 *
 */

'use strict';

const utils = require('@iobroker/adapter-core');
const path = require('path');
const express = require('express');
const app = express();
const { normalizeButtons, evaluateConditions, runActions } = require('./lib/buttons');

const adapter = new utils.Adapter('opensesame');

let buttons = [];
let sseClients = [];
let server = null;
// cache of foreign state values, keyed by state id, kept warm via subscriptions
const stateCache = {};

adapter.on('unload', function (callback) {
    try {
        sseClients.forEach((res) => res.end());
        sseClients = [];
        if (server) {
            server.close();
        }
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('stateChange', function (id, state) {
    if (!state) {
        return;
    }
    stateCache[id] = state.val;
    broadcastEvent('stateChange', { id, val: state.val, ack: state.ack });
});

adapter.on('ready', function () {
    main();
});

function broadcastEvent(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach((res) => res.write(payload));
}

// getState helper used by the condition evaluator and button actions - prefers
// the live subscription cache, falls back to a direct lookup for states we
// aren't subscribed to (e.g. referenced only by a script action).
function getState(id) {
    if (Object.prototype.hasOwnProperty.call(stateCache, id)) {
        return Promise.resolve(stateCache[id]);
    }
    return new Promise((resolve) => {
        adapter.getForeignState(id, (err, state) => {
            resolve(err || !state ? undefined : state.val);
        });
    });
}

function setState(id, value) {
    return new Promise((resolve, reject) => {
        adapter.setForeignState(id, value, (err) => (err ? reject(err) : resolve()));
    });
}

function subscribeButtonStates(list) {
    const ids = new Set();
    list.forEach((button) => {
        if (button.conditions && Array.isArray(button.conditions.items)) {
            button.conditions.items.forEach((c) => ids.add(c.stateId));
        }
        button.actions.forEach((a) => {
            if (a.type !== 'script' && a.stateId) {
                ids.add(a.stateId);
            }
        });
    });
    ids.forEach((id) => {
        adapter.subscribeForeignStates(id);
        adapter.getForeignState(id, (err, state) => {
            if (!err && state) {
                stateCache[id] = state.val;
            }
        });
    });
}

function main() {
    adapter.log.info('port of web server: ' + adapter.config.port);

    buttons = normalizeButtons(adapter.config);
    subscribeButtonStates(buttons);

    // this is a small, actively-edited LAN tool - correctness after a redeploy
    // matters far more than caching perf, so never let the browser cache these
    const staticOpts = { setHeaders: (res) => res.set('Cache-Control', 'no-store') };
    app.use(express.static(path.join(__dirname, 'views'), staticOpts));
    app.use(express.static(path.join(__dirname, 'css'), staticOpts));
    app.use(express.static(path.join(__dirname, 'js'), staticOpts));
    app.use(express.json());

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'index.html'));
    });

    app.get('/buttons', (req, res) => {
        res.json(
            buttons.map((b) => ({
                id: b.id,
                name: b.name,
                icon: b.icon,
                kind: b.kind,
                invert: b.invert,
                confirm: b.confirm,
                val: b.actions[0] && b.actions[0].type === 'state' ? stateCache[b.actions[0].stateId] : undefined,
            }))
        );
    });

    // legacy endpoint kept for compatibility with the old frontend/bookmarks
    app.get('/get', (req, res) => {
        res.json(
            buttons.map((b, i) => ({
                index: i,
                id: b.id,
                name: b.name,
                val: b.actions[0] && b.actions[0].type === 'state' ? stateCache[b.actions[0].stateId] : undefined,
            }))
        );
    });

    app.get('/events', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        res.write('\n');
        sseClients.push(res);
        req.on('close', () => {
            sseClients = sseClients.filter((c) => c !== res);
        });
    });

    app.post('/press/:id', async (req, res) => {
        const button = buttons.find((b) => b.id === req.params.id);
        if (!button) {
            res.status(404).json({ error: 'unknown button' });
            return;
        }

        const ctx = { getState, setState, log: adapter.log };
        try {
            const allowed = await evaluateConditions(button.conditions, getState);
            if (!allowed) {
                adapter.log.info(`button ${button.id} blocked by conditions`);
                res.json({ ok: false, blocked: true });
                return;
            }
            await runActions(button.actions, ctx);
            res.json({ ok: true });
        } catch (e) {
            adapter.log.error(`button ${button.id} failed: ${e.message}`);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // legacy endpoint kept for compatibility with the old frontend/bookmarks
    app.get('/open', (req, res) => {
        const id = req.query.id;
        const button = buttons.find((b) => b.id === id);
        if (!button) {
            res.status(404).end();
            return;
        }
        runActions(button.actions, { getState, setState, log: adapter.log })
            .then(() => res.json({ ok: true }))
            .catch((e) => res.status(500).json({ ok: false, error: e.message }));
    });

    server = app.listen(adapter.config.port, () => adapter.log.info(`listening on port ${adapter.config.port}!`));
}
